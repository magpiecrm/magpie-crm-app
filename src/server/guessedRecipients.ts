// Campaigns that include prospected addresses the mail server never
// confirmed (at companies that accept every address, say) send those in a
// first batch and hold the rest, so a wrong format can't bounce at scale
// and hurt the sending IPs' reputation for everyone:
//
//   1. Confirmed addresses (and anyone not from prospecting) go out as usual.
//   2. Up to FIRST_GUESS_BATCH unconfirmed ones go out with them; a campaign
//      with no more than that sends them all.
//   3. GUESS_HOLD_MS later, once bounces have had time to come back, the
//      scheduler looks at hard bounces among them: over MAX_GUESS_BOUNCE_RATE
//      and the rest stay held (the user can still send them); otherwise
//      they're sent.

import type { GuessHold } from './db'
import { isUnconfirmedGuess, type EmailStatus } from './prospecting/types'

export const FIRST_GUESS_BATCH = 50
export const GUESS_HOLD_MS = 60 * 60_000
/** One bounce in a full first batch of 50 is tolerated; two stop the rest. */
export const MAX_GUESS_BOUNCE_RATE = 0.02

type Recipient = { source?: string; email_status?: EmailStatus }

/**
 * Who this send goes to, and who waits. `startHold` when this send is the
 * first batch and some are held back.
 */
export function splitGuesses<T extends Recipient>(
  contacts: T[],
  hold: GuessHold | null | undefined,
  releasing: boolean,
): { send: T[]; held: T[]; firstBatch: number; startHold: boolean } {
  const guessed = contacts.filter(isUnconfirmedGuess)
  const sure = contacts.filter((c) => !isUnconfirmedGuess(c))
  // Sending the held-back ones: only them, not anyone added to the list since.
  if (releasing) return { send: guessed, held: [], firstBatch: 0, startHold: false }
  if (hold?.status === 'released') return { send: contacts, held: [], firstBatch: 0, startHold: false }
  // Already waiting on (or stopped after) a first batch, e.g. a resumed send.
  if (hold) return { send: sure, held: guessed, firstBatch: 0, startHold: false }
  if (guessed.length <= FIRST_GUESS_BATCH) return { send: contacts, held: [], firstBatch: guessed.length, startHold: false }
  const first = guessed.slice(0, FIRST_GUESS_BATCH)
  return { send: [...sure, ...first], held: guessed.slice(FIRST_GUESS_BATCH), firstBatch: first.length, startHold: true }
}

/** Whether the held rest may go out, given hard bounces among the first batch. */
export function firstBatchPassed(hold: GuessHold, hardBounces: number): boolean {
  return hold.first_batch > 0 && hardBounces / hold.first_batch <= MAX_GUESS_BOUNCE_RATE
}
