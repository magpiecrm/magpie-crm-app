// People-search hits fetched beyond what a page used, kept so the next page
// or top-up of the same search doesn't pay for another request: SocialFetch
// charges 3 credits a request, whether it returns 1 person or 50.
//
// In memory only, never on disk: only the allowed fields of each hit
// (mapPerson), held for an hour at most from when they were fetched, capped
// in size, and gone on restart. A search's position points at the first
// person not yet used, so losing the pool only costs a request, never a
// skipped person.

import type { PersonResult } from './types'

const HOUR = 3_600_000

export interface HeldHits {
  /** The hits in search order; null for a record that couldn't be read (it still takes its place in the offsets). */
  people: Array<PersonResult | null>
  /** SocialFetch has more after these. */
  hasMore: boolean
  /** SocialFetch's own offset after these, where the search carries on once they're all used. */
  end: number
  reportedTotal: number | null
  /** When they were fetched: they're held for `ttlMs` from then, however often they're split. */
  at: number
}

interface Options {
  ttlMs: number
  /** Most searches held at once; the oldest are dropped first. */
  maxSearches: number
  now: () => number
}

const DEFAULTS: Options = { ttlMs: HOUR, maxSearches: 200, now: () => Date.now() }

export function createSearchPool(options: Partial<Options> = {}) {
  const opts = { ...DEFAULTS, ...options }
  const held = new Map<string, HeldHits>()
  const expired = (h: HeldHits) => opts.now() - h.at >= opts.ttlMs

  return {
    /** The hits held from this point of a search, taken out of the pool; null when none (or too old). */
    take(key: string): HeldHits | null {
      const hit = held.get(key)
      if (!hit) return null
      held.delete(key)
      return expired(hit) ? null : hit
    },
    /** Holds the hits from this point of a search. */
    put(key: string, hits: HeldHits) {
      for (const [k, h] of held) if (expired(h)) held.delete(k)
      if (hits.people.length === 0 || expired(hits)) return
      held.delete(key)
      held.set(key, hits)
      while (held.size > opts.maxSearches) held.delete(held.keys().next().value!)
    },
    /** For tests. */
    size: () => held.size,
  }
}

export type SearchPool = ReturnType<typeof createSearchPool>

/** One point in one search: the same request parameters (not the page size) and where in the results it starts. */
export function searchPoolKey(params: Record<string, string | undefined>, start: number): string {
  const sorted = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .map((k) => [k, params[k]])
  return JSON.stringify([sorted, start])
}
