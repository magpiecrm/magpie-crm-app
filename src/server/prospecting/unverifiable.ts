// People whose email couldn't be verified, remembered so search can leave
// them out next time (while Settings → Prospect search hides unverifiable
// people) before paying for their profile lookup again.
//
// Only lookups that ended in a way that won't change on a retry count: the
// company accepts every address, every likely format was rejected, the domain
// takes no email, the surname is hidden, or the name can't be an address. Our
// own problems (limits, refused or blocked IPs, no answer, greylisting) and a
// missing company domain, which the user can add, never do.
//
// Kept per copy, 90 days, as the keyed HMAC hash of the profile URL (like the
// disclosure log): never the name, URL or address, and never shared.

import type { db as Db } from '../db'
import { profileHash } from './suppressionHash'
import type { LookupOutcome } from './types'

// `formatConfirmed` only reaches here when such guesses are withheld.
const DEFINITE = new Set<LookupOutcome>(['catchAll', 'formatConfirmed', 'rejected', 'noMail', 'hiddenSurname', 'badName'])
const KEEP_MS = 90 * 24 * 60 * 60_000

type Store = Pick<typeof Db, 'getUnverifiable' | 'setUnverifiable'>

const fresh = <T extends { created_at: string }>(entries: T[], now: number) => entries.filter((e) => now - new Date(e.created_at).getTime() < KEEP_MS)

/** Remembers the person when the lookup ended for good; true if it did. */
export function rememberIfUnverifiable(profileUrl: string, outcome: LookupOutcome, store: Store, now = new Date()): boolean {
  if (!DEFINITE.has(outcome)) return false
  const hash = profileHash(profileUrl)
  if (!hash) return false
  const kept = fresh(store.getUnverifiable(), now.getTime()).filter((e) => e.hash !== hash)
  store.setUnverifiable([...kept, { hash, outcome, created_at: now.toISOString() }])
  return true
}

/** Hashes of the people remembered in the last 90 days. */
export function unverifiableHashes(store: Pick<Store, 'getUnverifiable'>, now = Date.now()): Set<string> {
  return new Set(fresh(store.getUnverifiable(), now).map((e) => e.hash))
}
