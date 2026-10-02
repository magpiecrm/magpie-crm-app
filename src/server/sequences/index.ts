// Sequences: making and editing them, enrolling people, and what the People
// tab and the contact page show. The sending itself is engine.ts, run by the
// email scheduler. Each step's emails are recorded under a hidden campaign
// row (`campaigns.sequence_id`), so tracking, unsubscribes, bounces and
// results work as they do for campaigns.

import { randomUUID } from 'node:crypto'
import { db, type DbSchema } from '../db'
import {
  defaultSettings,
  type Enrollment,
  type EnrollmentView,
  type Sequence,
  type SequenceSettings,
  type SequenceStep,
  type SequenceSummary,
} from '../../features/sequences/types'
import { isUnconfirmedGuess } from '../prospecting/types'
import { optedOutAt, signedUpSince } from '../prospecting/suppression'
import { dueAfter, firstSendable, isTimeZone, remapStep } from './schedule'
import { logActivity } from '../sales/deals'
import { notify } from '../notify'

const now = () => new Date().toISOString()
const normEmail = (e: string) => e.toLowerCase().trim()
/** Most people enrolled in one go. */
export const MAX_ENROLL = 5000

function seqOf(data: DbSchema, id: string): Sequence {
  const s = data.sequences?.find((x) => x.id === id)
  if (!s) throw new Error('Sequence not found')
  return s
}

const enrollmentsOf = (data: DbSchema, sequenceId: string) => (data.sequence_enrollments ?? []).filter((e) => e.sequence_id === sequenceId)

function summary(data: DbSchema, s: Sequence): SequenceSummary {
  const es = enrollmentsOf(data, s.id)
  const count = (status: Enrollment['status']) => es.filter((e) => e.status === status).length
  const sender = data.senders.find((x) => x.id === s.sender_id)
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    paused_reason: s.paused_reason,
    sender: sender ? (sender.name ? `${sender.name} <${sender.email}>` : sender.email) : null,
    steps: s.steps.length,
    enrolled: es.length,
    active: count('active'),
    replied: count('replied'),
    finished: count('finished'),
    bounced: count('bounced'),
    unsubscribed: count('unsubscribed'),
    sent: es.reduce((n, e) => n + e.sends.length, 0),
    updated_at: s.updated_at,
  }
}

function cleanSteps(steps: Array<Partial<SequenceStep>>, old: SequenceStep[] = []): SequenceStep[] {
  if (steps.length > 10) throw new Error('A sequence can have at most 10 emails.')
  return steps.map((st, i) => {
    const kept = old.find((o) => o.id === st.id)
    const delay = Math.round(Number(st.delay_days ?? (i === 0 ? 0 : 3)))
    if (!Number.isFinite(delay) || delay < 0 || delay > 90) throw new Error('Wait between 0 and 90 days between emails.')
    const subject = st.subject?.trim() ? st.subject.trim().slice(0, 200) : null
    return {
      id: kept?.id ?? st.id ?? randomUUID(),
      delay_days: delay,
      subject: i === 0 ? (subject ?? '') : subject,
      body: String(st.body ?? '').slice(0, 10_000),
      ...(kept?.campaign_id ? { campaign_id: kept.campaign_id } : {}),
    }
  })
}

function cleanSettings(patch: Partial<SequenceSettings>, base: SequenceSettings): SequenceSettings {
  const s = { ...base, ...patch }
  if (!isTimeZone(s.time_zone)) throw new Error(`"${s.time_zone}" isn't a time zone.`)
  const days = [...new Set((s.days ?? []).map(Number).filter((d) => d >= 0 && d <= 6))].sort()
  const start = Math.round(Number(s.start_hour))
  const end = Math.round(Number(s.end_hour))
  if (!(start >= 0 && end <= 24 && start < end)) throw new Error('Sending hours must start before they end, between 0 and 24.')
  const cap = Math.round(Number(s.daily_cap))
  if (!(cap >= 1 && cap <= 500)) throw new Error('Emails a day must be between 1 and 500.')
  return {
    track_opens: Boolean(s.track_opens),
    track_clicks: Boolean(s.track_clicks),
    days,
    start_hour: start,
    end_hour: end,
    time_zone: s.time_zone,
    daily_cap: cap,
    signature: String(s.signature ?? '').slice(0, 2000),
    footer: String(s.footer ?? '').slice(0, 1000),
  }
}

/** What's missing before a sequence can send, or null when it's ready. */
export function notReady(data: DbSchema, s: Sequence): string | null {
  if (!data.senders.some((x) => x.id === s.sender_id)) return 'Choose who it sends from.'
  if (!s.steps.length) return 'Add at least one email.'
  if (!s.steps[0].subject?.trim()) return 'The first email needs a subject.'
  const empty = s.steps.findIndex((st) => !st.body.trim())
  if (empty >= 0) return `Email ${empty + 1} has no text.`
  if (!/\{\{\s*unsubscribe\s*\}\}/i.test(s.settings.footer)) return 'The last line needs the {{ unsubscribe }} link, so people can opt out.'
  if (!s.settings.days.length) return 'Choose at least one day to send on.'
  return null
}

/** Why each address can't be enrolled, or null when it can (in this data). */
function whyNot(data: DbSchema, s: Sequence, email: string, optedOut: Map<string, string>): string | null {
  const contact = data.contacts.find((c) => c.email === email)
  if (!contact) return 'not_contact'
  if (contact.status === 'bounced') return 'bounced'
  if (contact.status !== 'subscribed') return 'unsubscribed'
  const stop = db.emailStop(email)
  if (!signedUpSince(stop?.at, contact.signed_up_at)) return stop?.reason === 'bounced' ? 'bounced' : 'unsubscribed'
  if (!signedUpSince(optedOut.get(email), contact.signed_up_at)) return 'opted_out'
  if ((data.sequence_enrollments ?? []).some((e) => e.sequence_id === s.id && e.contact_email === email)) return 'already_in'
  if ((data.sequence_enrollments ?? []).some((e) => e.contact_email === email && e.status === 'active' && e.sequence_id !== s.id)) return 'in_another'
  return null
}

const read = <T>(fn: (data: DbSchema) => T): T => fn(db.data)
const write = <T>(fn: (data: DbSchema) => T): T => db.mutate(fn)

export const sequences = {
  list: (): SequenceSummary[] =>
    read((data) => (data.sequences ?? []).filter((s) => s.status !== 'archived').map((s) => summary(data, s)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))),

  get: (id: string): { sequence: Sequence; summary: SequenceSummary; notReady: string | null } =>
    read((data) => {
      const s = seqOf(data, id)
      return { sequence: s, summary: summary(data, s), notReady: notReady(data, s) }
    }),

  create: (input: { name: string; senderId?: number | null; timeZone?: string }, actor: string | null): Sequence =>
    write((data) => {
      const name = input.name.trim()
      if (!name) throw new Error('Give the sequence a name.')
      const at = now()
      const tz = input.timeZone && isTimeZone(input.timeZone) ? input.timeZone : 'Europe/London'
      const sequence: Sequence = {
        id: randomUUID(),
        name: name.slice(0, 120),
        sender_id: input.senderId ?? data.senders[0]?.id ?? null,
        status: 'draft',
        paused_reason: null,
        steps: cleanSteps([
          { delay_days: 0, subject: '', body: '' },
          { delay_days: 3, subject: null, body: '' },
        ]),
        settings: defaultSettings(tz),
        guess_gate: null,
        next_slot_at: null,
        created_by: actor,
        created_at: at,
        updated_at: at,
      }
      ;(data.sequences ??= []).push(sequence)
      return sequence
    }),

  /** Changes its name, sender, emails or settings. People carry on from the same email where it's still there. */
  update: (
    id: string,
    patch: { name?: string; senderId?: number | null; steps?: Array<Partial<SequenceStep>>; settings?: Partial<SequenceSettings> },
  ): Sequence =>
    write((data) => {
      const s = seqOf(data, id)
      if (patch.name !== undefined) {
        if (!patch.name.trim()) throw new Error('Give the sequence a name.')
        s.name = patch.name.trim().slice(0, 120)
      }
      if (patch.senderId !== undefined) {
        if (patch.senderId !== null && !data.senders.some((x) => x.id === patch.senderId)) throw new Error('Sender not found')
        s.sender_id = patch.senderId
      }
      if (patch.settings) s.settings = cleanSettings(patch.settings, s.settings)
      if (patch.steps) {
        const old = s.steps
        const steps = cleanSteps(patch.steps, old)
        if (!steps.length) throw new Error('Add at least one email.')
        for (const e of enrollmentsOf(data, s.id)) {
          if (e.status !== 'active' && e.status !== 'paused') continue
          e.next_step = remapStep(e.next_step, old, steps)
          if (e.next_step >= steps.length) {
            e.status = 'finished'
            e.next_send_at = null
          } else if (e.status === 'active' || e.status === 'paused') {
            // A changed wait applies from their last email (or enrolling).
            e.next_send_at = dueAfter(e.sends.at(-1)?.at ?? e.enrolled_at, steps[e.next_step].delay_days)
          }
        }
        s.steps = steps
      }
      if (s.status === 'active' && notReady(data, s)) throw new Error(notReady(data, s)!)
      s.updated_at = now()
      return s
    }),

  /** Starts, pauses or archives it. Starting checks it's ready. */
  setStatus: (id: string, status: 'active' | 'paused' | 'archived'): Sequence =>
    write((data) => {
      const s = seqOf(data, id)
      if (status === 'active') {
        const why = notReady(data, s)
        if (why) throw new Error(why)
      }
      s.status = status
      s.paused_reason = null
      s.auto_paused = null
      s.updated_at = now()
      if (status === 'archived') {
        for (const e of enrollmentsOf(data, s.id)) {
          if (e.status !== 'active' && e.status !== 'paused') continue
          e.status = 'stopped'
          e.stop_reason = 'The sequence was archived'
          e.next_send_at = null
        }
      }
      return s
    }),

  /** Deletes a sequence nothing has been sent from (one that has sent is archived instead, to keep its history). */
  remove: (id: string) =>
    write((data) => {
      const s = seqOf(data, id)
      if (enrollmentsOf(data, id).some((e) => e.sends.length)) throw new Error('It has sent emails, so it can only be archived.')
      data.sequences = data.sequences!.filter((x) => x.id !== id)
      data.sequence_enrollments = (data.sequence_enrollments ?? []).filter((e) => e.sequence_id !== s.id)
    }),

  /**
   * Enrolls contacts (by email): each gets the first email once it's due and
   * the sequence is running. Leaves out anyone unsubscribed, bounced or opted
   * out, anyone already in it, and anyone in another running sequence.
   * `dryRun` counts without enrolling.
   */
  enroll: (id: string, emails: string[], opts: { dryRun?: boolean }, actor: string | null) => {
    const unique = [...new Set(emails.map(normEmail))]
    if (unique.length > MAX_ENROLL) throw new Error(`Enroll at most ${MAX_ENROLL.toLocaleString('en-GB')} people at a time.`)
    const run = (data: DbSchema) => {
      const s = seqOf(data, id)
      if (s.status === 'archived') throw new Error('This sequence is archived.')
      const contacts = unique.map((e) => data.contacts.find((c) => c.email === e)).filter((c): c is NonNullable<typeof c> => !!c)
      const optedOut = optedOutAt(db, contacts)
      const skipped: Record<string, number> = {}
      const ok: string[] = []
      for (const email of unique) {
        const why = whyNot(data, s, email, optedOut)
        if (why) skipped[why] = (skipped[why] ?? 0) + 1
        else ok.push(email)
      }
      if (!opts.dryRun && ok.length) {
        const at = now()
        const list = (data.sequence_enrollments ??= [])
        for (const email of ok) {
          list.push({
            id: randomUUID(),
            sequence_id: s.id,
            contact_email: email,
            status: 'active',
            stop_reason: null,
            next_step: 0,
            next_send_at: dueAfter(at, s.steps[0]?.delay_days ?? 0),
            claim: null,
            sends: [],
            attempts: 0,
            replied_at: null,
            reply: null,
            enrolled_at: at,
            enrolled_by: actor,
          })
        }
        s.updated_at = at
      }
      return { enrolled: ok.length, skipped }
    }
    return opts.dryRun ? read(run) : write(run)
  },

  enrollments: (id: string, status?: Enrollment['status']): EnrollmentView[] =>
    read((data) => {
      const s = seqOf(data, id)
      return enrollmentsOf(data, id)
        .filter((e) => !status || e.status === status)
        .map(({ claim: _claim, ...e }) => {
          const c = data.contacts.find((x) => x.email === e.contact_email)
          return {
            ...e,
            name: [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || null,
            company: c?.company || null,
            guessed: c ? isUnconfirmedGuess(c as any) : false,
            next_send_at: sendableAt(e.next_send_at, s),
          }
        })
        .sort((a, b) => b.enrolled_at.localeCompare(a.enrolled_at))
    }),

  /**
   * Pause or resume people, mark that they replied (which stops them), stop
   * them, or take them out (only before anything was sent to them).
   */
  act: (ids: string[], action: 'pause' | 'resume' | 'mark_replied' | 'stop' | 'remove') =>
    write((data) => {
      const set = new Set(ids)
      const list = data.sequence_enrollments ?? []
      const at = now()
      let changed = 0
      for (const e of list.filter((x) => set.has(x.id))) {
        const open = e.status === 'active' || e.status === 'paused'
        if (action === 'pause' && e.status === 'active') e.status = 'paused'
        else if (action === 'resume' && e.status === 'paused') {
          e.status = 'active'
          e.stop_reason = null
          if (e.next_send_at && e.next_send_at < at) e.next_send_at = at
        } else if (action === 'mark_replied' && (open || e.status === 'finished')) {
          markReplied(data, e, { at, matched_by: 'manual' })
        } else if (action === 'stop' && open) {
          e.status = 'stopped'
          e.stop_reason = 'Stopped by hand'
          e.next_send_at = null
        } else if (action === 'remove' && !e.sends.length && !e.claim) {
          data.sequence_enrollments = data.sequence_enrollments!.filter((x) => x.id !== e.id)
        } else continue
        changed++
      }
      return { changed }
    }),

  /** A contact's sequences, for their page. */
  forContact: (email: string) =>
    read((data) =>
      (data.sequence_enrollments ?? [])
        .filter((e) => e.contact_email === normEmail(email))
        .map((e) => {
          const s = data.sequences?.find((x) => x.id === e.sequence_id)
          return {
            id: e.id,
            sequence_id: e.sequence_id,
            sequence_name: s?.name ?? 'Deleted sequence',
            steps: s?.steps.length ?? 0,
            status: e.status,
            stop_reason: e.stop_reason,
            sent: e.sends.length,
            next_send_at: e.status === 'active' && s ? sendableAt(e.next_send_at, s) : null,
            replied_at: e.replied_at,
            enrolled_at: e.enrolled_at,
          }
        }),
    ),

  /** Per email: how many it went to, and opened, clicked, replied, bounced and unsubscribed (people, bots excluded). */
  stepStats: (id: string) =>
    read((data) => {
      const s = seqOf(data, id)
      const es = enrollmentsOf(data, id)
      return s.steps.map((st, i) => {
        const rows = st.campaign_id ? data.campaign_recipients.filter((r) => r.campaign_id === st.campaign_id) : []
        return {
          step: i + 1,
          id: st.id,
          sent: rows.length,
          opened: rows.filter((r) => r.opened_at).length,
          clicked: rows.filter((r) => r.clicked_at).length,
          replied: rows.filter((r) => r.replied_at).length,
          bounced: rows.filter((r) => r.status === 'bounced_hard').length,
          unsubscribed: rows.filter((r) => r.unsubscribed_at).length,
          waiting: es.filter((e) => e.status === 'active' && e.next_step === i).length,
        }
      })
    }),
}

/** When an email due at `due` can go: inside the sequence's sending days and hours. */
function sendableAt(due: string | null, s: Sequence): string | null {
  if (!due) return null
  const at = firstSendable(new Date(Math.max(Date.parse(due), Date.now())), s.settings)
  return at ? at.toISOString() : due
}

/** Stops an enrollment because they replied, and notes it on the email they replied to. */
export function markReplied(data: DbSchema, e: Enrollment, reply: NonNullable<Enrollment['reply']>) {
  e.status = 'replied'
  e.replied_at = reply.at
  e.reply = reply
  e.next_send_at = null
  e.stop_reason = null
  const last = e.sends.at(-1)
  const row = last && data.campaign_recipients.find((r) => r.campaign_id === last.campaign_id && r.contact_email === e.contact_email)
  if (row) row.replied_at ??= reply.at
}

/**
 * A reply found in the sender's inbox (mailboxes/): stops their sequence,
 * notes it on their open deal, and tells the user. A reply asking not to be
 * emailed again ("stop", "unsubscribe") also unsubscribes them, as the
 * link in the email would.
 */
export function replyReceived(enrollmentId: string, reply: { at: string; matched_by: 'thread' | 'from'; stop: boolean }) {
  const done = db.mutate((data) => {
    const e = data.sequence_enrollments?.find((x) => x.id === enrollmentId)
    if (!e || e.status === 'replied') return null
    markReplied(data, e, { at: reply.at, matched_by: reply.matched_by })
    const s = data.sequences?.find((x) => x.id === e.sequence_id)
    const c = data.contacts.find((x) => x.email === e.contact_email)
    const who = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || e.contact_email
    const deal = data.deals?.find((d) => d.status === 'open' && d.contact_emails.includes(e.contact_email))
    if (deal) {
      logActivity(data, {
        kind: 'email',
        deal_id: deal.id,
        company_id: deal.company_id,
        contact_email: e.contact_email,
        body: `${who} replied to "${s?.name ?? 'a sequence'}"${reply.stop ? ' asking not to be emailed again' : ''}`,
        created_by: null,
      })
    }
    return { e, who, sequence: s, lastCampaign: e.sends.at(-1)?.campaign_id }
  })
  if (!done) return
  if (reply.stop) {
    db.mutate((data) => {
      const c = data.contacts.find((x) => x.email === done.e.contact_email)
      if (c) c.status = 'unsubscribed'
    })
    db.stopEmail(done.e.contact_email, 'unsubscribed')
    db.markRecipientUnsubscribed(done.e.contact_email, done.lastCampaign)
  }
  notify(
    'sequence_reply',
    `${done.who} replied to "${done.sequence?.name ?? 'a sequence'}"${reply.stop ? ' asking not to be emailed again, so they\'re unsubscribed' : ''}`,
    { url: done.sequence ? `/sales/sequences/${done.sequence.id}?tab=people` : '/sales/sequences', contactEmail: done.e.contact_email },
  )
}
