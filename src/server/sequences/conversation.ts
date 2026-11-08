// One person's conversation with a sequence, for Sell → Inbox and the
// sequence's Replies tab: the sequence's emails as they went (rebuilt from
// the step, or their own version where it's personalised), then their
// replies and the answers to them (ThreadMessage, kept by mailboxes/), in
// order. The inbox lists them across sequences: a conversation needs a reply
// while their message is the latest and nobody has marked it done. And
// answering from the app: from the sequence's sender, threaded under their
// latest message, with a copy put in the sender's inbox's Sent folder so the
// conversation is whole there too.

import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import { db, type DbSchema } from '../db'
import { sendMail } from '../nodemailer'
import { inboxOf, lastActivity } from '../mailboxes'
import { imapConnect, type Connect } from '../mailboxes/imap'
import { logActivity } from '../sales/deals'
import { composeText, htmlDocument, renderStep, textHash, textToHtml } from './render'
import { stripRe } from './schedule'
import { sequences, unreadIn } from '.'
import { snippet } from '../../features/sequences/quote'
import {
  REPLY_TEXT_MAX,
  draftFor,
  type ConversationDeal,
  type ConversationItem,
  type ConversationView,
  type Enrollment,
  type EnrollmentView,
  type InboxList,
  type InboxRow,
  type MissingReply,
  type Sequence,
  type ThreadMessage,
} from '../../features/sequences/types'

/** Most of their message quoted under an answer. */
const QUOTE_MAX = 4_000
/** Most conversations the inbox lists, the latest first. */
const LIST_MAX = 500

function enrollmentOf(data: DbSchema, id: string): Enrollment {
  const e = data.sequence_enrollments?.find((x) => x.id === id)
  if (!e) throw new Error("They're not in this sequence any more.")
  return e
}

function sequenceOf(data: DbSchema, id: string): Sequence {
  const s = data.sequences?.find((x) => x.id === id)
  if (!s) throw new Error('Sequence not found')
  return s
}

const nameOf = (c: { first_name?: string | null; last_name?: string | null } | undefined) => [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || null

/** Why an answer can't be sent to them from here, in words; null when it can. */
function cannotReply(data: DbSchema, e: Enrollment, s: Sequence): string | null {
  if (!data.senders.some((x) => x.id === s.sender_id)) return 'This sequence has no sender address any more: choose one in its Settings.'
  if (!e.reply && !(e.messages ?? []).some((m) => m.direction === 'in')) return "They haven't replied yet. Once they do, you can answer here."
  const status = data.contacts.find((c) => c.email === e.contact_email)?.status
  const stop = db.emailStop(e.contact_email)
  if (stop?.reason === 'bounced' || status === 'bounced') return 'Their address bounced, so nothing more can go to it.'
  if (stop?.reason === 'complained') return 'They marked an email as spam, so nothing more goes to them.'
  if (stop || (status && status !== 'subscribed')) return "They've unsubscribed, so nothing more goes to them from here. If they asked something, answer from your own inbox."
  return null
}

/** The message an answer answers: their latest, else (a reply marked by hand) the last sequence email. */
function answering(e: Enrollment): { messageId: string; references: string[]; subject: string; theirs: ThreadMessage | null } | null {
  const theirs = (e.messages ?? []).filter((m) => m.direction === 'in' && m.message_id).reduce<ThreadMessage | null>((a, b) => (!a || b.at >= a.at ? b : a), null)
  if (theirs) return { messageId: theirs.message_id!, references: theirs.references ?? [], subject: theirs.subject, theirs }
  const last = e.sends.at(-1)
  return last ? { messageId: last.message_id, references: e.sends.slice(0, -1).map((x) => x.message_id), subject: last.subject, theirs: null } : null
}

/** Whether someone is in the inbox: they replied (or it was marked by hand), or there's a conversation. */
const inInbox = (e: Enrollment) => !!e.reply || !!e.messages?.length

const latestOf = (e: Enrollment) => (e.messages ?? []).reduce<ThreadMessage | null>((a, b) => (!a || b.at >= a.at ? b : a), null)

/** Why none of their words show, if none do: a reply from before they were kept (not read yet, or not in the inbox), or one marked by hand. */
function missingReply(e: Enrollment): MissingReply {
  if (!e.reply || (e.messages ?? []).some((m) => m.direction === 'in')) return null
  if (e.reply.matched_by === 'manual') return 'manual'
  return e.reply_searched_at ? 'not_found' : 'pending'
}

/**
 * Whether it waits for an answer from here: their message is the latest (or
 * their reply, not read yet, is all there is), nobody has marked it done
 * since, and they can be answered. One marked as replied by hand doesn't: it
 * was dealt with elsewhere.
 */
function awaitsAnswer(data: DbSchema, e: Enrollment, s: Sequence): boolean {
  const last = latestOf(e)
  const theirs = last ? (last.direction === 'in' ? last.at : null) : e.reply && e.reply.matched_by !== 'manual' ? e.reply.at : null
  if (!theirs || (e.inbox_done_at && e.inbox_done_at >= theirs)) return false
  return !cannotReply(data, e, s)
}

/** The deal someone's conversation belongs to: their open one, else their latest. */
function dealFor(data: DbSchema, email: string): ConversationDeal | null {
  const theirs = (data.deals ?? []).filter((d) => d.contact_emails.includes(email))
  const deal = theirs.find((d) => d.status === 'open') ?? theirs.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  if (!deal) return null
  const stage = data.pipelines?.find((p) => p.id === deal.pipeline_id)?.stages.find((st) => st.id === deal.stage_id)
  return { id: deal.id, name: deal.name, status: deal.status, pipeline_id: deal.pipeline_id, stage_id: deal.stage_id, stage: stage?.name ?? '' }
}

function inboxRow(data: DbSchema, e: Enrollment, s: Sequence): InboxRow {
  const c = data.contacts.find((x) => x.email === e.contact_email)
  const last = latestOf(e)
  const at = [lastActivity(e), e.reply?.at ?? ''].reduce((a, b) => (b > a ? b : a))
  return {
    enrollment_id: e.id,
    sequence: { id: s.id, name: s.name },
    email: e.contact_email,
    name: nameOf(c),
    title: c?.job_title || null,
    company: c?.company || null,
    at,
    last: last ? { direction: last.direction, snippet: snippet(last.text) } : null,
    missing_reply: missingReply(e),
    unread: unreadIn(e.messages),
    needs_reply: awaitsAnswer(data, e, s),
    deal: dealFor(data, e.contact_email),
  }
}

export const conversations = {
  /** Conversations across sequences, the latest first: those needing a reply, or all; from one sequence, or every one. */
  inbox: (filter: { needsReply?: boolean; sequenceId?: string } = {}): InboxList => {
    const data = db.data
    const all = (data.sequence_enrollments ?? []).filter(inInbox).flatMap((e) => {
      const s = data.sequences?.find((x) => x.id === e.sequence_id)
      return s ? [inboxRow(data, e, s)] : []
    })
    const shown = all.filter((r) => !filter.sequenceId || r.sequence.id === filter.sequenceId)
    const sequenceNames = new Map(all.map((r) => [r.sequence.id, r.sequence.name]))
    return {
      rows: shown
        .filter((r) => filter.needsReply === undefined || r.needs_reply === filter.needsReply)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, LIST_MAX),
      needs_reply: shown.filter((r) => r.needs_reply).length,
      sequences: [...sequenceNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    }
  },

  /** How many conversations wait for an answer, for the sidebar. */
  waiting: (): number => {
    const data = db.data
    return (data.sequence_enrollments ?? []).filter((e) => {
      const s = inInbox(e) && data.sequences?.find((x) => x.id === e.sequence_id)
      return !!s && awaitsAnswer(data, e, s)
    }).length
  },

  /** Marks a conversation as needing no answer, or as needing one again. */
  setDone: (enrollmentId: string, done: boolean): void =>
    db.mutate((data) => {
      enrollmentOf(data, enrollmentId).inbox_done_at = done ? new Date().toISOString() : null
    }),


  /** Everyone in a sequence who has replied, the latest conversation first. */
  replies: (sequenceId: string): EnrollmentView[] => {
    const latest = (e: EnrollmentView) => e.last_message?.at ?? e.replied_at ?? ''
    return sequences
      .enrollments(sequenceId)
      .filter((e) => e.reply || e.last_message)
      .sort((a, b) => latest(b).localeCompare(latest(a)))
  },

  /** How many of their messages haven't been looked at, across a sequence. */
  unread: (sequenceId: string): number => (db.data.sequence_enrollments ?? []).filter((e) => e.sequence_id === sequenceId).reduce((n, e) => n + unreadIn(e.messages), 0),

  get: (enrollmentId: string): ConversationView => {
    const data = db.data
    const e = enrollmentOf(data, enrollmentId)
    const s = sequenceOf(data, e.sequence_id)
    const contact = data.contacts.find((c) => c.email === e.contact_email)
    const sender = data.senders.find((x) => x.id === s.sender_id) ?? null
    const fromLabel = sender ? sender.name || sender.email : 'You'
    const needs = awaitsAnswer(data, e, s)

    const sends: ConversationItem[] = e.sends.map((send, i) => {
      const index = s.steps.findIndex((st) => st.id === send.step_id)
      const draft = draftFor(e, send.step_id)
      // As the engine sends it: their own version where it was written, else the step's.
      const body = draft?.status === 'ready' && draft.body ? draft.body : s.steps[index]?.body
      const text = body === undefined ? '' : renderStep({ subject: send.subject, body, contact: contact ?? { email: e.contact_email }, settings: s.settings, unsubscribeUrl: '' }).text
      const edited = body === undefined || (!!send.text_hash && send.text_hash !== textHash(composeText(body, s.settings)))
      return {
        key: `send-${i}`,
        kind: 'step',
        direction: 'out',
        from: fromLabel,
        subject: send.subject,
        at: send.at,
        text,
        ...(index >= 0 ? { step: index + 1 } : {}),
        ...(edited ? { edited_since: true } : {}),
        ...(send.uncertain ? { uncertain: true } : {}),
      }
    })
    const messages: ConversationItem[] = (e.messages ?? []).map((m) => ({
      key: m.id,
      kind: 'message',
      direction: m.direction,
      ...(m.via ? { via: m.via } : {}),
      // Their name when it's from them, the address when it's someone else in the thread.
      from: m.direction === 'out' ? fromLabel : m.from === e.contact_email ? (nameOf(contact) ?? m.from) : m.from,
      subject: m.subject,
      at: m.at,
      text: m.text,
      ...(m.truncated ? { truncated: true } : {}),
      ...(m.attachments ? { attachments: m.attachments } : {}),
      ...(m.direction === 'in' ? { seen: !!m.seen } : {}),
      ...(m.sent_copy !== undefined ? { sent_copy: m.sent_copy } : {}),
    }))

    return {
      enrollment_id: e.id,
      sequence_id: s.id,
      contact_email: e.contact_email,
      name: nameOf(contact),
      company: contact?.company || null,
      status: e.status,
      sender: sender ? { name: sender.name, email: sender.email } : null,
      inbox_connected: !!sender && !!inboxOf(sender.id),
      items: [...sends, ...messages].sort((a, b) => a.at.localeCompare(b.at)),
      cannot_reply: cannotReply(data, e, s),
      signature: s.settings.signature.trim(),
      sequence_name: s.name,
      title: contact?.job_title || null,
      company_id: contact?.company_id ?? null,
      deal: dealFor(data, e.contact_email),
      needs_reply: needs,
      done: !!e.inbox_done_at && !needs,
      missing_reply: missingReply(e),
    }
  },

  /** Marks their messages in a conversation as looked at. */
  markSeen: (enrollmentId: string): { changed: number } =>
    db.mutate((data) => {
      let changed = 0
      for (const m of enrollmentOf(data, enrollmentId).messages ?? []) {
        if (m.direction === 'in' && !m.seen) {
          m.seen = true
          changed++
        }
      }
      return { changed }
    }),
}

/** Answers being sent, by the page's id for them, so a second click while the first is out sends nothing. */
const sending = new Set<string>()

/**
 * Sends an answer to someone who replied: their own words and the
 * sequence's sign-off, then their message quoted, as a reply in its thread
 * ("Re: …", In-Reply-To and References), to whoever wrote it. No tracking,
 * and no unsubscribe link: it's one email to one person who wrote to you.
 * Keeps it in the conversation, then puts a copy in the sender's Sent folder
 * (`copied`: whether that worked, null with no inbox connected).
 */
export async function sendReply(
  enrollmentId: string,
  input: { text: string; clientId: string },
  actor: string | null,
  connect: Connect = imapConnect,
): Promise<{ message: ThreadMessage; copied: Promise<boolean | null> }> {
  const words = input.text.replace(/\r\n?/g, '\n').trim()
  if (!words) throw new Error('Write your answer first.')
  if (words.length > REPLY_TEXT_MAX) throw new Error("That's too long for one email.")
  const e = enrollmentOf(db.data, enrollmentId)
  const before = e.messages?.find((m) => m.client_id === input.clientId)
  if (before) return { message: before, copied: Promise.resolve(before.sent_copy ?? null) }
  if (sending.has(input.clientId)) throw new Error("It's being sent.")
  const s = sequenceOf(db.data, e.sequence_id)
  const why = cannotReply(db.data, e, s)
  if (why) throw new Error(why)
  const target = answering(e)
  if (!target) throw new Error('There is nothing in this conversation to answer yet.')
  const sender = db.data.senders.find((x) => x.id === s.sender_id)!
  const contact = db.data.contacts.find((c) => c.email === e.contact_email)

  // To whoever wrote (a colleague answering in the thread, say); to them when answering the sequence's email.
  const to = target.theirs?.from || e.contact_email
  const from = sender.name ? `"${sender.name}" <${sender.email}>` : sender.email
  const subject = `Re: ${stripRe(target.subject || e.sends.at(-1)?.subject || '')}`.trim()
  const messageId = `<${randomUUID()}@${sender.email.split('@')[1] ?? 'localhost'}>`
  const references = [...new Set([...target.references, target.messageId])].slice(-10)
  const mine = [words, s.settings.signature.trim()].filter(Boolean).join('\n\n')

  let text = mine
  let html = textToHtml(mine)
  if (target.theirs) {
    const theirs = target.theirs
    const when = new Date(theirs.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: s.settings.time_zone })
    const name = theirs.from === e.contact_email ? nameOf(contact) : null
    const attribution = `On ${when}, ${name ? `${name} <${theirs.from}>` : theirs.from} wrote:`
    const quoted = theirs.text.length > QUOTE_MAX ? `${theirs.text.slice(0, QUOTE_MAX)}\n[…]` : theirs.text
    text += `\n\n${attribution}\n${quoted
      .split('\n')
      .map((l) => `> ${l}`.trimEnd())
      .join('\n')}`
    html += `<br>\n<br>\n<div class="gmail_quote">${textToHtml(attribution)}<br>\n<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${textToHtml(quoted)}</blockquote></div>`
  }
  html = htmlDocument(html)

  sending.add(input.clientId)
  try {
    await sendMail({ from, to, subject, text, html, messageId, inReplyTo: target.messageId, references })
  } finally {
    sending.delete(input.clientId)
  }

  const message: ThreadMessage = {
    id: randomUUID(),
    client_id: input.clientId,
    direction: 'out',
    via: 'app',
    message_id: messageId,
    in_reply_to: target.messageId,
    references,
    from: sender.email,
    subject,
    at: new Date().toISOString(),
    text: mine,
  }
  db.mutate((data) => {
    const live = data.sequence_enrollments?.find((x) => x.id === enrollmentId)
    if (live) (live.messages ??= []).push(message)
    const deal = data.deals?.find((d) => d.status === 'open' && d.contact_emails.includes(e.contact_email))
    if (deal) {
      logActivity(data, {
        kind: 'email',
        deal_id: deal.id,
        company_id: deal.company_id,
        contact_email: e.contact_email,
        body: `Answered ${nameOf(contact) ?? e.contact_email}'s reply to "${s.name}"`,
        created_by: actor,
      })
    }
  })

  const copied = copyToSent(sender.id, { from, to, subject, text, html, messageId, inReplyTo: target.messageId, references, date: new Date(message.at) }, connect).then((ok) => {
    if (ok !== null) db.mutate(() => void (message.sent_copy = ok))
    return ok
  })
  return { message, copied }
}

/** Puts a copy of an answer in the sender's inbox's Sent folder; null when no inbox is connected, false when it didn't work. */
async function copyToSent(
  senderId: number,
  mail: { from: string; to: string; subject: string; text: string; html: string; messageId: string; inReplyTo: string; references: string[]; date: Date },
  connect: Connect,
): Promise<boolean | null> {
  const box = inboxOf(senderId)
  if (!box?.login || box.record.status === 'auth_failed') return null
  try {
    const raw = await new MailComposer(mail).compile().build()
    const client = await connect(box.login)
    try {
      return await client.appendSent(raw)
    } finally {
      await client.close().catch(() => {})
    }
  } catch (err) {
    console.warn(`[Replies] couldn't put an answer in the Sent folder at ${box.record.host}: ${(err as Error)?.message ?? err}`)
    return false
  }
}
