// Sequences: a few plain-text emails to each person enrolled, days apart,
// stopping when they reply, unsubscribe or bounce (server/sequences/).
// Follow-ups go in the same conversation ("Re: <first subject>") unless a
// step starts a new one with its own subject.

export interface SequenceStep {
  id: string
  /** Days after the previous step (after enrolling, for the first). */
  delay_days: number
  /** Null: a reply in the current thread ("Re: …"). The first step needs one. */
  subject: string | null
  /** Plain text with merge tags ({{ contact.first_name }}). */
  body: string
  /** The hidden campaign row its sends are recorded under, from its first send (tracking and results). */
  campaign_id?: number
}

export interface SequenceSettings {
  /** The hidden open-tracking image (needs consent under PECR). Off by default: it also hurts cold email's deliverability. */
  track_opens: boolean
  /** Links go through our click tracking. Off by default, for the same reasons. */
  track_clicks: boolean
  /** Days it sends on, 0 = Sunday … 6 = Saturday, in `time_zone`. */
  days: number[]
  /** Sends between these hours (local, 0-24). */
  start_hour: number
  end_hour: number
  /** IANA, e.g. Europe/London. */
  time_zone: string
  /** Most emails a day from this sequence (first emails and follow-ups together). */
  daily_cap: number
  /** Below every email: who it's from (sign-off). */
  signature: string
  /** Last line of every email; must contain {{ unsubscribe }}. */
  footer: string
}

export type SequenceStatus = 'draft' | 'active' | 'paused' | 'archived'

/**
 * Unconfirmed prospected addresses on the first step (guessedRecipients.ts):
 * the first batch goes out, the rest wait until the bounces are in, and
 * carry on only if few bounced.
 */
export interface SequenceGuessGate {
  status: 'waiting' | 'released' | 'stopped'
  first_batch: number
  held: number
  release_at: string
  max_bounce_rate?: number
  hard_bounces?: number
}

export interface Sequence {
  id: string
  name: string
  sender_id: number | null
  status: SequenceStatus
  /** Why it paused itself (out of emails this month, sending domain not ready…); null when paused by hand. */
  paused_reason: string | null
  /** Paused itself for something that may clear (out of emails, sending domain not ready): resumes by itself once it has. */
  auto_paused?: 'allowance' | 'sending_domain' | 'reply_detection' | null
  steps: SequenceStep[]
  settings: SequenceSettings
  guess_gate: SequenceGuessGate | null
  /** Pacing: the next email goes no sooner than this. */
  next_slot_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type EnrollmentStatus = 'active' | 'paused' | 'replied' | 'finished' | 'unsubscribed' | 'bounced' | 'stopped'

export interface EnrollmentSend {
  step_id: string
  campaign_id: number
  /** Our Message-ID (with <>), for threading follow-ups and matching replies. */
  message_id: string
  subject: string
  at: string
  /** Committed after a restart mid-send: it may not have gone out. */
  uncertain?: true
}

export interface Enrollment {
  id: string
  sequence_id: string
  contact_email: string
  status: EnrollmentStatus
  /** Why it stopped or paused, in words. */
  stop_reason: string | null
  /** Index of the next step to send. */
  next_step: number
  next_send_at: string | null
  /** A send in progress (engine.ts), so it's never sent twice. */
  claim: { step_id: string; message_id: string; at: string } | null
  sends: EnrollmentSend[]
  attempts: number
  replied_at: string | null
  reply: { at: string; matched_by: 'manual' | 'thread' | 'from' } | null
  enrolled_at: string
  enrolled_by: string | null
}

const DEFAULT_FOOTER = "Not interested? Unsubscribe here and I won't email you again: {{ unsubscribe }}"

export function defaultSettings(timeZone = 'Europe/London'): SequenceSettings {
  return {
    track_opens: false,
    track_clicks: false,
    days: [1, 2, 3, 4, 5],
    start_hour: 9,
    end_hour: 17,
    time_zone: timeZone,
    daily_cap: 50,
    signature: '',
    footer: DEFAULT_FOOTER,
  }
}

/** A sequence as the list shows it. */
export interface SequenceSummary {
  id: string
  name: string
  status: SequenceStatus
  paused_reason: string | null
  sender: string | null
  steps: number
  enrolled: number
  active: number
  replied: number
  finished: number
  bounced: number
  unsubscribed: number
  sent: number
  updated_at: string
}

/** One enrollment as the People tab shows it. */
export interface EnrollmentView extends Omit<Enrollment, 'claim'> {
  name: string | null
  company: string | null
  /** The contact is an unconfirmed prospected address (guessedRecipients.ts). */
  guessed: boolean
}

/** A sender's connected inbox, as Settings shows it (never the password). */
export interface MailboxView {
  id: string
  sender_id: number
  sender: string
  host: string
  port: number
  secure: boolean
  user: string
  status: 'ok' | 'auth_failed' | 'error'
  last_error: string | null
  error_since: string | null
  last_polled_at: string | null
  folder: string | null
  replies_found: number
}
