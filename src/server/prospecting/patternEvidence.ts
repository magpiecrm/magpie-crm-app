// A company's address format, worked out from addresses this copy already
// has there, for when its mail server can't confirm one (it accepts every
// address) or before spending checks on guesses.
//
//   - `known`: a contact the user imported, added or had sign up, or one
//     prospected and verified: a real address, so a vote for its format.
//   - `engaged`: a prospected contact whose unconfirmed address was clicked
//     in a campaign: it reached someone, so a vote for its format.
//   - `bounced`: a prospected contact whose unconfirmed address hard-bounced:
//     a vote against its format (the person may also have left, so it only
//     lowers confidence, it doesn't rule the format out).
//
// Addresses are only read, in memory, at lookup time. Nothing here is
// stored: the domain record keeps formats learned from SMTP checks only.

import { formatPrior } from './formatStats'
import { inferPattern, type EmailPattern } from './patterns'

export interface KnownAddress {
  email: string
  firstName: string
  lastName: string
  kind: 'known' | 'engaged' | 'bounced'
}

export interface FormatEvidence {
  pattern: EmailPattern
  /** Addresses in this format that are real (known or engaged). */
  agree: number
  /** Real addresses in other formats, plus bounces in this one. */
  against: number
  /** 0-1: the chance a new address in this format is right. */
  confidence: number
}

/**
 * The best-supported format at a company, or null when no address there
 * matches any format. Confidence starts from the format's prior (`formatPrior`)
 * counted as one address, so one match lifts first.last from about 0.5 to
 * 0.74, and three matches to 0.87; each address in another format, or bounce
 * in this one, pulls it back down.
 */
export function weighFormats(addresses: KnownAddress[], headcount?: number | null): FormatEvidence | null {
  const real = new Map<EmailPattern, number>()
  const bounced = new Map<EmailPattern, number>()
  const seen = new Set<string>()
  for (const a of addresses) {
    const email = a.email.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    const pattern = inferPattern(email, a.firstName, a.lastName)
    if (!pattern) continue
    const counts = a.kind === 'bounced' ? bounced : real
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1)
  }
  const totalReal = [...real.values()].reduce((n, c) => n + c, 0)

  let best: FormatEvidence | null = null
  for (const [pattern, agree] of real) {
    const against = totalReal - agree + (bounced.get(pattern) ?? 0)
    const confidence = (agree + formatPrior(pattern, headcount)) / (agree + against + 1)
    if (!best || confidence > best.confidence) best = { pattern, agree, against, confidence }
  }
  return best
}
