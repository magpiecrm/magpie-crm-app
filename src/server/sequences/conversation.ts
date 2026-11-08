// One person's conversation with a sequence, for its Replies tab: the
// sequence's emails as they went (rebuilt from the step, or their own
// version where it's personalised), then their replies and the answers to
// them (ThreadMessage, kept by mailboxes/), in order. And answering from the
// app: from the sequence's sender, threaded under their latest message, with
// a copy put in the sender's inbox's Sent folder so the conversation is
// whole there too.

import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import { db, type DbSchema } from '../db'
import { sendMail } from '../nodemailer'
import { inboxOf } from '../mailboxes'
import { imapConnect, type Connect } from '../mailboxes/imap'
import { logActivity } from '../sales/deals'
import { composeText, htmlDocument, renderStep, textHash, textToHtml } from './render'
import { stripRe } from './schedule'
import { sequences, unreadIn } from '.'
import { REPLY_TEXT_MAX, draftFor, type ConversationItem, type ConversationView, type Enrollment, type EnrollmentView, type Sequence, type ThreadMessage } from '../../features/sequences/types'

/** Most of their message quoted under an answer. */
const QUOTE_MAX = 4_000

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

export const conversations = {
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
