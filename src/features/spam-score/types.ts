// The spam score as the campaign and sequence screens show it
// (server/spamScore/): an estimate of how likely an email is to land in spam,
// from what it says, who sends it and who it goes to, with what to change.

export type SpamPart = 'content' | 'sender' | 'recipients'
export type SpamLevel = 'low' | 'medium' | 'high'

export interface SpamFinding {
  /** Stable id, e.g. `subject_caps`. */
  code: string
  part: SpamPart
  /** Added to the score; 0 for a note. */
  points: number
  /** Makes the score High on its own (a blocklisted domain, a poor reputation…). */
  hard?: boolean
  /** Editing the email (or its tracking switches) can fix it. Sender and recipient findings can't be. */
  fixable: boolean
  /** What's wrong and why it matters. */
  text: string
  /** What to do about it. */
  fix: string
  /** The sequence email it's about, from 1. */
  step?: number
}

export interface SpamStepScore {
  /** From 1. */
  step: number
  score: number
  level: SpamLevel
  /** This email's own findings; the sequence's sender and recipient findings apply to every step. */
  findings: SpamFinding[]
}

export interface SpamScore {
  /** 0-100: under 25 low, 25-59 medium, 60 and over high. */
  score: number
  level: SpamLevel
  /** Worst first. */
  findings: SpamFinding[]
  /** A sequence's emails, each scored with its sender and recipients. */
  steps?: SpamStepScore[]
  /** Where the host offers it: the Warmup page's sender check measures where mail really lands. */
  senderCheck: boolean
}

/** Score bands, shared by the server and the card. */
export const SPAM_LEVELS = { medium: 25, high: 60 } as const

export const levelOf = (score: number): SpamLevel => (score >= SPAM_LEVELS.high ? 'high' : score >= SPAM_LEVELS.medium ? 'medium' : 'low')
