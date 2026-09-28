// Campaigns that include prospected addresses the mail server never
// confirmed (at companies that accept every address, say) send those in a
// first batch and hold the rest, so a wrong format can't bounce at scale
// and hurt the sending IPs' reputation for everyone:
//
//   1. Confirmed addresses (and anyone not from prospecting) go out as usual.
//   2. Up to `firstBatch` unconfirmed ones go out with them; a campaign with
//      no more than that sends them all.
//   3. At least `holdHours` later, and once the bounces have arrived (the
//      host has passed on every event from its mail server, or the bounce
//      poller has read past that time; see emailService.ts), the scheduler
//      looks at hard bounces among them: over `maxBounceRate` and the rest
//      stay held (the user can still send them); otherwise they're sent.
//
// The numbers are the host's in a hosted copy, set in its admin portal
// (prospecting/hostRules.ts), and the defaults there otherwise: 50, 1 hour,
// 2% (one bounce in a full first batch is tolerated; two stop the rest).

import type { GuessHold } from './db'
import { DEFAULT_RULES, type ProspectingRules } from './prospecting/hostRules'
import { isUnconfirmedGuess, type EmailStatus } from './prospecting/types'

/** A host or bounce poller that never catches up doesn't hold the rest forever: judged anyway this long after release. */
export const BOUNCE_WAIT_CAP_MS = 24 * 60 * 60_000

type Recipient = { source?: string; email_status?: EmailStatus }

/**
 * Who this send goes to, and who waits. `startHold` when this send is the
 * first batch and some are held back.
 */
export function splitGuesses<T extends Recipient>(
  contacts: T[],
  hold: GuessHold | null | undefined,
  releasing: boolean,
  firstBatchSize = DEFAULT_RULES.firstBatch,
): { send: T[]; held: T[]; firstBatch: number; startHold: boolean } {
  const guessed = contacts.filter(isUnconfirmedGuess)
  const sure = contacts.filter((c) => !isUnconfirmedGuess(c))
  // Sending the held-back ones: only them, not anyone added to the list since.
  if (releasing) return { send: guessed, held: [], firstBatch: 0, startHold: false }
  if (hold?.status === 'released') return { send: contacts, held: [], firstBatch: 0, startHold: false }
  // Already waiting on (or stopped after) a first batch, e.g. a resumed send.
  if (hold) return { send: sure, held: guessed, firstBatch: 0, startHold: false }
  if (guessed.length <= firstBatchSize) return { send: contacts, held: [], firstBatch: guessed.length, startHold: false }
  const first = guessed.slice(0, firstBatchSize)
  return { send: [...sure, ...first], held: guessed.slice(firstBatchSize), firstBatch: first.length, startHold: true }
}

/** A new hold for a first batch just sent, with the rules it's judged by. */
export function newHold(firstBatch: number, held: number, rules: ProspectingRules, now = Date.now()): GuessHold {
  return {
    status: 'waiting',
    first_batch: firstBatch,
    held,
    release_at: new Date(now + rules.holdHours * 60 * 60_000).toISOString(),
    max_bounce_rate: rules.maxBounceRate,
  }
}

/** Whether the held rest may go out, given hard bounces among the first batch. */
export function firstBatchPassed(hold: GuessHold, hardBounces: number): boolean {
  return hold.first_batch > 0 && hardBounces / hold.first_batch <= (hold.max_bounce_rate ?? DEFAULT_RULES.maxBounceRate)
}
