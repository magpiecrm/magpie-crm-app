// Sends sequence emails, a few a minute at most (the email scheduler runs it
// every minute). For each running sequence, inside its sending days and hours
// in its own time zone, under its daily cap and paced through the day, it
// sends one due email: follow-ups before first emails. Each send is claimed
// before it goes and committed after, so an email is never sent twice: a
// claim left by a restart is taken as sent (recoverClaims).
//
// It skips (and ends) people who unsubscribed, bounced or opted out since
// they were enrolled, holds unconfirmed prospected addresses after a first
// batch until their bounces are in (guessedRecipients.ts), and pauses the
// sequence, with a notification, when the plan's emails run out or the
// sending domain isn't ready, resuming by itself once they are.

import { randomUUID } from 'node:crypto'
import { db, type DbSchema } from '../db'
import type { Enrollment, Sequence } from '../../features/sequences/types'
import { sendMail } from '../nodemailer'
import { encryptToken } from '../crypto'
import { getAppUrl } from '../appUrl'
import { notify } from '../notify'
import { AllowanceError, remaining, requireAllowance } from '../allowance'
import { canSendFrom, requireSendingDomain } from '../sendingDomains'
import { env } from '../env'
import { isUnknownRecipient } from '../providers/types'
import { isUnconfirmedGuess } from '../prospecting/types'
import { optedOutAt, signedUpSince } from '../prospecting/suppression'
import { prospectingRules } from '../prospecting/hostRules'
import { firstBatchPassed, newHold } from '../guessedRecipients'
import { dailyRoom } from '../sendingLimits'
import { renderStep } from './render'
import { dueAfter, inSendWindow, minutesLeft, nextGapMs, sentToday, threadFor } from './schedule'

/**
 * With the sender's inbox connected, a follow-up only goes once it has been
 * read this recently, so nobody gets one after replying; and a sequence
 * pauses when the inbox has failed this long.
 */
const FRESH_INBOX_MS = 15 * 60_000
const BROKEN_INBOX_MS = 60 * 60_000

/** A failed send is tried again this much later, at most this many times. */
const RETRY_MS = 30 * 60_000
const MAX_ATTEMPTS = 3

type Contact = DbSchema['contacts'][number]

/** The hidden campaign row a step's emails are recorded under, made on its first send. */
function stepCampaign(data: DbSchema, s: Sequence, stepIndex: number): number {
  const step = s.steps[stepIndex]
  const existing = step.campaign_id && data.campaigns.find((c) => c.id === step.campaign_id)
  if (existing) return existing.id
  const id = data.campaigns.length ? Math.max(...data.campaigns.map((c) => c.id)) + 1 : 1
  data.campaigns.push({
    id,
    name: `${s.name}: email ${stepIndex + 1}`,
    subject: step.subject ?? '',
    preview_text: null,
    html_content: '',
    list_id: null,
    sender_id: s.sender_id,
    status: 'sequence',
    unsubscribe_enabled: true,
    track_opens: s.settings.track_opens,
    created_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
    sequence_id: s.id,
    step_id: step.id,
  })
  step.campaign_id = id
  return id
}

function pause(s: Sequence, reason: string, auto: Sequence['auto_paused'] = null) {
  db.mutate(() => {
    s.status = 'paused'
    s.paused_reason = reason
    s.auto_paused = auto
    s.updated_at = new Date().toISOString()
  })
  notify('sequence_paused', `"${s.name}" paused: ${reason}`, { url: `/sales/sequences/${s.id}` })
}

function end(e: Enrollment, status: Enrollment['status'], reason: string) {
  db.mutate(() => {
    e.status = status
    e.stop_reason = reason
    e.next_send_at = null
  })
}

/** Why a contact can't be emailed any more (and how their enrollment ends), or null. */
function cannotEmail(contact: Contact | undefined): { status: Enrollment['status']; reason: string } | null {
  if (!contact) return { status: 'stopped', reason: 'The contact was deleted' }
  if (contact.status === 'bounced') return { status: 'bounced', reason: 'Their address bounced' }
  if (contact.status !== 'subscribed') return { status: 'unsubscribed', reason: 'Unsubscribed' }
  const stop = db.emailStop(contact.email)
  if (!signedUpSince(stop?.at, contact.signed_up_at)) {
    return stop?.reason === 'bounced' ? { status: 'bounced', reason: 'Their address bounced' } : { status: 'unsubscribed', reason: 'Unsubscribed' }
  }
  const opted = optedOutAt(db, [contact]).get(contact.email)
  if (!signedUpSince(opted, contact.signed_up_at)) return { status: 'stopped', reason: 'Opted out of being contacted' }
  return null
}

/**
 * Whether an unconfirmed address may get its first email now: the first
 * batch goes; then they wait until the bounces are in, and carry on only if
 * few bounced. Advances the sequence's gate as it goes.
 */
async function guessAllowed(s: Sequence, now: Date): Promise<boolean> {
  const rules = prospectingRules()
  const gate = s.guess_gate
  if (gate?.status === 'released') return true
  if (gate?.status === 'stopped') return false
  if (!gate) {
    const sent = (db.data.sequence_enrollments ?? []).filter(
      (e) => e.sequence_id === s.id && e.sends.length > 0 && isUnconfirmedGuess((db.getContact(e.contact_email) ?? {}) as any),
    ).length
    if (sent < rules.firstBatch) return true
    const held = (db.data.sequence_enrollments ?? []).filter((e) => e.sequence_id === s.id && e.status === 'active' && !e.sends.length).length
    db.mutate(() => (s.guess_gate = newHold(sent, held, rules, now.getTime())))
    return false
  }
  if (Date.parse(gate.release_at) > now.getTime()) return false
  const { bouncesCaughtUp } = await import('../emailService')
  if (!(await bouncesCaughtUp(gate.release_at, now))) return false
  const firstStep = s.steps[0]?.campaign_id
  const bounces = firstStep ? db.unconfirmedHardBounces(firstStep) : 0
  const passed = firstBatchPassed(gate, bounces)
  db.mutate(() => (s.guess_gate = { ...gate, status: passed ? 'released' : 'stopped', hard_bounces: bounces }))
  if (!passed) {
    notify(
      'sequence_paused',
      `"${s.name}": ${bounces} of the first ${gate.first_batch} unconfirmed addresses bounced, so the rest won't be emailed. Confirmed addresses carry on.`,
      { url: `/sales/sequences/${s.id}` },
    )
  }
  return passed
}

/** Resumes a sequence that paused itself once what stopped it has cleared. */
function maybeResume(s: Sequence) {
  if (s.status !== 'paused' || !s.auto_paused) return
  const sender = db.data.senders.find((x) => x.id === s.sender_id)
  const box = db.data.mailboxes?.find((m) => m.sender_id === s.sender_id)
  const cleared =
    s.auto_paused === 'allowance'
      ? remaining('emailsSent') > 0
      : s.auto_paused === 'reply_detection'
        ? !box || box.status === 'ok'
        : !!sender && (!env.sendingManaged() || canSendFrom(sender.email))
  if (!cleared) return
  db.mutate(() => {
    s.status = 'active'
    s.paused_reason = null
    s.auto_paused = null
  })
}

/** Sends at most one email from this sequence, if one is due and allowed. True if it sent one. */
async function runOne(s: Sequence, now: Date, appUrl: string, random: () => number): Promise<boolean> {
  if (!inSendWindow(now, s.settings)) return false
  if (s.next_slot_at && Date.parse(s.next_slot_at) > now.getTime()) return false
  const mine = (db.data.sequence_enrollments ?? []).filter((e) => e.sequence_id === s.id)
  const today = sentToday(mine.flatMap((e) => e.sends.map((x) => x.at)), now, s.settings.time_zone)
  if (today >= s.settings.daily_cap) return false

  const sender = db.data.senders.find((x) => x.id === s.sender_id)
  if (!sender) {
    pause(s, 'Its sender was deleted. Choose another in Settings.')
    return false
  }
  const from = sender.name ? `"${sender.name}" <${sender.email}>` : sender.email

  const due = mine
    .filter((e) => e.status === 'active' && !e.claim && e.next_send_at && Date.parse(e.next_send_at) <= now.getTime())
    // Follow-ups first, then whoever's been waiting longest.
    .sort((a, b) => Number(b.next_step > 0) - Number(a.next_step > 0) || a.next_send_at!.localeCompare(b.next_send_at!))

  // Replies are read from the sender's inbox, when it's connected.
  const box = db.data.mailboxes?.find((m) => m.sender_id === s.sender_id)
  if (box && box.status !== 'ok' && due.some((e) => e.next_step > 0)) {
    const broken = box.status === 'auth_failed' || (box.error_since && now.getTime() - Date.parse(box.error_since) > BROKEN_INBOX_MS)
    if (broken) {
      pause(s, `Replies can't be read from ${box.user} (${box.last_error ?? 'error'}), so follow-ups would go to people who've replied. Fix it in Settings → Reply detection, or disconnect the inbox to send without it.`, 'reply_detection')
      return false
    }
  }
  const inboxCurrent = !box || (box.status === 'ok' && !!box.last_polled_at && now.getTime() - Date.parse(box.last_polled_at) <= FRESH_INBOX_MS)

  let room: ((email: string) => boolean) | undefined
  for (const e of due) {
    // A follow-up waits until the inbox has been read for replies.
    if (e.next_step > 0 && !inboxCurrent) continue
    const step = s.steps[e.next_step]
    if (!step) {
      end(e, 'finished', 'Sent every email')
      continue
    }
    const contact = db.getContact(e.contact_email) ?? undefined
    const blocked = cannotEmail(contact)
    if (blocked) {
      end(e, blocked.status, blocked.reason)
      continue
    }
    if (e.next_step === 0 && isUnconfirmedGuess(contact as any) && !(await guessAllowed(s, now))) continue
    // Today's sending limit for this kind of contact is used up (sendingLimits.ts): they wait, others may still go.
    if (!(room ??= dailyRoom(now))(e.contact_email)) continue

    try {
      requireAllowance('emailsSent', 1, 'Sending this sequence')
      requireSendingDomain(sender.email)
    } catch (err) {
      if (err instanceof AllowanceError) pause(s, 'Your plan has no emails left this month.', 'allowance')
      else pause(s, (err as Error).message, 'sending_domain')
      return false
    }

    // Claim it, so a restart can never send it twice.
    const domain = sender.email.split('@')[1] ?? 'localhost'
    const messageId = `<${randomUUID()}@${domain}>`
    const cid = db.mutate((data) => {
      const id = stepCampaign(data, s, e.next_step)
      e.claim = { step_id: step.id, message_id: messageId, at: now.toISOString() }
      return id
    })

    const thread = threadFor(step, e.sends, s.steps)
    const unsubscribeUrl = `${appUrl}/api/unsubscribe?t=${encodeURIComponent(encryptToken({ email: e.contact_email, campaignId: cid }))}`
    const rendered = renderStep(
      { subject: thread.subject, body: step.body, contact: contact!, settings: s.settings, unsubscribeUrl },
      {
        openUrl: `${appUrl}/api/track/open?t=${encodeURIComponent(encryptToken({ email: e.contact_email, campaignId: cid }))}`,
        clickUrl: (url) => `${appUrl}/api/track/click?t=${encodeURIComponent(encryptToken({ email: e.contact_email, campaignId: cid, url }))}`,
      },
    )

    try {
      await sendMail({
        from,
        to: e.contact_email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        campaignId: cid,
        unsubscribeUrl,
        messageId,
        inReplyTo: thread.inReplyTo,
        references: thread.references,
      })
    } catch (err) {
      if (err instanceof AllowanceError) {
        db.mutate(() => (e.claim = null))
        pause(s, 'Your plan has no emails left this month.', 'allowance')
        return false
      }
      console.error(`[Sequences] Failed to send "${s.name}" email ${e.next_step + 1} to ${e.contact_email}:`, err)
      db.mutate(() => {
        e.claim = null
        e.attempts += 1
        e.next_send_at = new Date(now.getTime() + RETRY_MS).toISOString()
      })
      if (isUnknownRecipient(err)) {
        // Recorded against the step like a campaign's; stopEmail ends the enrollment.
        db.mutate((data) => data.campaign_recipients.push({ campaign_id: cid, contact_email: e.contact_email, status: 'bounced_soft', opened_at: null, clicked_at: null, sent_at: now.toISOString() }))
        db.updateRecipientBounceStatus(e.contact_email, 'hard', String(cid))
      } else if (e.attempts >= MAX_ATTEMPTS) {
        end(e, 'stopped', `Couldn't send: ${(err as Error)?.message ?? err}`)
      }
      return false
    }

    commit(e, s, { cid, messageId, subject: rendered.subject, at: now.toISOString() })
    const left = Math.max(1, s.settings.daily_cap - today - 1)
    db.mutate(() => (s.next_slot_at = new Date(now.getTime() + nextGapMs(minutesLeft(now, s.settings), left, random)).toISOString()))
    return true
  }
  return false
}

/** Records a send and moves the enrollment on to its next email (unless a reply stopped it meanwhile). */
function commit(e: Enrollment, s: Sequence, sent: { cid: number; messageId: string; subject: string; at: string; uncertain?: true }) {
  db.mutate((data) => {
    const stepId = e.claim?.step_id ?? s.steps[e.next_step]?.id ?? ''
    e.sends.push({ step_id: stepId, campaign_id: sent.cid, message_id: sent.messageId, subject: sent.subject, at: sent.at, ...(sent.uncertain ? { uncertain: true as const } : {}) })
    e.claim = null
    e.attempts = 0
    if (!data.campaign_recipients.some((r) => r.campaign_id === sent.cid && r.contact_email === e.contact_email)) {
      data.campaign_recipients.push({ campaign_id: sent.cid, contact_email: e.contact_email, status: 'sent', opened_at: null, clicked_at: null, sent_at: sent.at })
    }
    if (e.status !== 'active') return
    const sentIndex = s.steps.findIndex((st) => st.id === stepId)
    const next = (sentIndex >= 0 ? sentIndex : e.next_step) + 1
    e.next_step = next
    if (next >= s.steps.length) {
      e.status = 'finished'
      e.stop_reason = null
      e.next_send_at = null
    } else {
      e.next_send_at = dueAfter(sent.at, s.steps[next].delay_days)
    }
  })
}

/**
 * Sends what's due across all running sequences, one email per sequence per
 * run. `random` is for tests.
 */
export async function runSequences(now = new Date(), random: () => number = Math.random): Promise<number> {
  let sent = 0
  const list = db.data.sequences ?? []
  if (!list.length) return 0
  const appUrl = await getAppUrl()
  for (const s of list) {
    maybeResume(s)
    if (s.status !== 'active') continue
    try {
      if (await runOne(s, now, appUrl, random)) sent++
    } catch (err) {
      console.error(`[Sequences] "${s.name}" failed:`, err)
    }
  }
  return sent
}

/**
 * After a restart: a claim still there means the server stopped while
 * sending it. It may have gone, so it's recorded as sent (marked uncertain)
 * rather than risk sending it twice.
 */
export function recoverClaims() {
  for (const e of db.data.sequence_enrollments ?? []) {
    if (!e.claim) continue
    const s = db.data.sequences?.find((x) => x.id === e.sequence_id)
    const step = s?.steps.find((st) => st.id === e.claim!.step_id)
    if (!s || !step?.campaign_id) {
      db.mutate(() => (e.claim = null))
      continue
    }
    const thread = threadFor(step, e.sends, s.steps)
    commit(e, s, { cid: step.campaign_id, messageId: e.claim.message_id, subject: thread.subject, at: e.claim.at, uncertain: true })
  }
}
