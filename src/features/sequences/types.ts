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
  /**
   * On the first step, and for the whole sequence: the AI writes each person
   * their own version of every email, the first and the follow-ups
   * (server/sequences/personalise.ts), from this brief and what it finds
   * about their company. Each step's own subject and body are the example it
   * follows, and what's sent when it can't write one.
   */
  personalise?: { brief: string } | null
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
  auto_paused?: 'allowance' | 'sending_domain' | 'reply_detection' | 'ai' | null
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
  /** A fingerprint of its words as written (render.ts textHash), so the Replies tab can tell when the step has changed since. */
  text_hash?: string
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
  /** Their own version of each email, by step id, where the sequence is personalised: written as each comes due. */
  drafts?: Record<string, PersonalDraft>
  /** The conversation after the sequence's emails: their replies, and the answers to them (ThreadMessage). */
  messages?: ThreadMessage[]
  /** When someone marked the conversation as needing no answer; a newer message from them asks for one again. */
  inbox_done_at?: string | null
  /** A reply from before replies' text was kept (or marked by hand): when the inbox was searched for it, once. */
  reply_searched_at?: string
}

/**
 * One email in a conversation that isn't a sequence email: a reply read
 * from the sender's connected inbox (mailboxes/), or an answer to one, sent
 * from the app or from the inbox itself. Plain text only, capped; kept with
 * the enrollment, so it goes when they do.
 */
export interface ThreadMessage {
  id: string
  /** The answer's id from the page that sent it, so sending again sends nothing twice. */
  client_id?: string
  /** `in`: from them; `out`: to them. */
  direction: 'in' | 'out'
  /** For an answer: sent from the app, or found in the inbox (sent from the mail app). */
  via?: 'app' | 'inbox'
  /** Its Message-ID (with <>), for threading and not keeping it twice. */
  message_id: string | null
  in_reply_to?: string | null
  references?: string[]
  from: string
  subject: string
  at: string
  text: string
  /** Its text was longer than REPLY_TEXT_MAX and was cut. */
  truncated?: true
  /** How many attachments it had (never kept). */
  attachments?: number
  /** An `in` message has been looked at. */
  seen?: boolean
  /** An answer from the app: whether its copy went into the inbox's Sent folder (absent: no inbox to put it in). */
  sent_copy?: boolean
}

/** Longest text kept for one message in a conversation. */
export const REPLY_TEXT_MAX = 20_000

/** A short fact about a person's company, and where it was read. */
export interface ResearchFact {
  text: string
  url: string | null
}

/**
 * One person's own version of one email (server/sequences/personalise.ts).
 * `pending` waits to be written, and the email waits with it; `ready` is
 * sent as written; `fallback` sends the step's own email, for `reason`. Kept
 * after it's sent, as the record of what went out.
 */
export interface PersonalDraft {
  status: 'pending' | 'ready' | 'fallback'
  /** None for a follow-up that replies in the thread ("Re: …"). */
  subject?: string
  body?: string
  /** What it was written from: the company facts it used. */
  facts?: ResearchFact[]
  /** Why the step's own email goes instead, in words. */
  reason?: string
  /** Edited by hand since it was written. */
  edited?: boolean
  at: string
  /** Tries that failed, so a draft that keeps failing falls back. */
  attempts: number
}

/** Longest brief for a personalised first email, and longest subject for one. */
export const BRIEF_MAX = 2_000
export const SUBJECT_MAX = 90

/** The sequence's emails are written for each person (server/sequences/personalise.ts). */
export const isPersonalised = (s: Pick<Sequence, 'steps'>) => !!s.steps[0]?.personalise

/** Their own version of a step's email, if there is one. */
export const draftFor = (e: Pick<Enrollment, 'drafts'>, stepId: string | undefined): PersonalDraft | undefined => (stepId ? e.drafts?.[stepId] : undefined)

/**
 * Enrollments from before a draft was kept for each email, whose one draft
 * (`personal`) was their first email's: moved to that step. Returns how many.
 */
export function moveFirstEmailDrafts(sequences: Array<Pick<Sequence, 'id' | 'steps'>>, enrollments: Array<Enrollment & { personal?: PersonalDraft }>): number {
  let moved = 0
  for (const e of enrollments) {
    if (!e.personal) continue
    const first = sequences.find((s) => s.id === e.sequence_id)?.steps[0]?.id
    if (first) e.drafts = { [first]: e.personal, ...e.drafts }
    delete e.personal
    moved++
  }
  return moved
}

/** A first email waiting to be written. */
export const pendingDraft = (now = new Date()): PersonalDraft => ({ status: 'pending', at: now.toISOString(), attempts: 0 })

/** `{{ unsubscribe }}` becomes the words "Unsubscribe here", linked (server/sequences/render.ts). */
export const DEFAULT_FOOTER = "Not interested? {{ unsubscribe }} and I won't email you again."
/** The default before the link was words: its address showed after the colon. */
export const FIRST_DEFAULT_FOOTER = "Not interested? Unsubscribe here and I won't email you again: {{ unsubscribe }}"

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

/** One enrollment as the People tab shows it (the conversation's text isn't in it: ConversationView is). */
export interface EnrollmentView extends Omit<Enrollment, 'claim' | 'messages'> {
  name: string | null
  company: string | null
  /** The contact is an unconfirmed prospected address (guessedRecipients.ts). */
  guessed: boolean
  /** Their messages not looked at yet. */
  unread: number
  /** The conversation's latest message after the sequence's emails, if there is one. */
  last_message: { at: string; direction: 'in' | 'out'; snippet: string } | null
}

/** One email in a conversation as the page shows it: a sequence email (`step`), or a ThreadMessage. */
export interface ConversationItem {
  key: string
  kind: 'step' | 'message'
  direction: 'in' | 'out'
  via?: 'app' | 'inbox'
  from: string
  subject: string
  at: string
  text: string
  truncated?: boolean
  attachments?: number
  /** A sequence email: its number in the sequence (1-based). */
  step?: number
  /** A sequence email rebuilt from a step edited since it went out: the words may differ. */
  edited_since?: boolean
  /** It may not have gone out (a restart mid-send). */
  uncertain?: boolean
  seen?: boolean
  sent_copy?: boolean
}

/** One person's whole conversation with a sequence, and whether it can be answered. */
export interface ConversationView {
  enrollment_id: string
  sequence_id: string
  contact_email: string
  name: string | null
  company: string | null
  status: EnrollmentStatus
  sender: { name: string; email: string } | null
  /** The sender's inbox is connected (else replies aren't read). */
  inbox_connected: boolean
  items: ConversationItem[]
  /** Why it can't be answered from here, in words; null when it can. */
  cannot_reply: string | null
  /** What goes under an answer (the sequence's sign-off). */
  signature: string
  sequence_name: string
  title: string | null
  /** Their contact's company, for starting a deal. */
  company_id: string | null
  deal: ConversationDeal | null
  /** Their message is the latest, nobody has marked it done since, and it can be answered. */
  needs_reply: boolean
  /** Marked as needing no answer, and nothing of theirs since. */
  done: boolean
  /** Why none of their words show: replied before they were kept (not read yet, or not found in the inbox), or marked by hand. */
  missing_reply: MissingReply
}

/** Why a reply's words don't show (ConversationView), or null when they do. */
export type MissingReply = 'pending' | 'not_found' | 'manual' | null

/** The deal someone's conversation belongs to: their open one, else their latest. */
export interface ConversationDeal {
  id: string
  name: string
  status: 'open' | 'won' | 'lost'
  pipeline_id: string
  stage_id: string
  stage: string
}

/** A conversation as the inbox lists it (Sell → Inbox, across sequences). */
export interface InboxRow {
  enrollment_id: string
  sequence: { id: string; name: string }
  email: string
  name: string | null
  title: string | null
  company: string | null
  /** When anything last happened in it. */
  at: string
  /** Its latest message after the sequence's emails, or null with none to show (`missing_reply` says why). */
  last: { direction: 'in' | 'out'; snippet: string } | null
  missing_reply: MissingReply
  unread: number
  needs_reply: boolean
  deal: ConversationDeal | null
}

export interface InboxList {
  rows: InboxRow[]
  /** How many need a reply, in the sequence and search asked for (whichever tab). */
  needs_reply: number
  /** The sequences anyone has replied to, for the filter. */
  sequences: Array<{ id: string; name: string }>
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
