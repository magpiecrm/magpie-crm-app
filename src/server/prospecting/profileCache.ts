// Remembers profile lookups (3 credits each) for a day, so the same person
// turning up in several searches, or being saved after being searched, is
// paid for once.
//
// In memory only, never on disk: it holds personal data (name, current title
// and employer), so it expires after a day, is capped in size, and is gone
// on restart. Search results themselves are still never persisted.

import type { PeopleSource, PersonResult } from './types'

const DAY = 86_400_000

interface Options {
  ttlMs: number
  /** Most people held at once; the oldest are dropped first. */
  max: number
  now: () => number
}

const DEFAULTS: Options = { ttlMs: DAY, max: 2_000, now: () => Date.now() }

export function withProfileCache<S extends PeopleSource>(source: S, options: Partial<Options> = {}): S {
  const opts = { ...DEFAULTS, ...options }
  const entries = new Map<string, { person: PersonResult | null; at: number }>()
  // Two lookups of the same person at once share one request.
  const inflight = new Map<string, Promise<PersonResult | null>>()

  const getPerson = async (profileRef: string): Promise<PersonResult | null> => {
    const hit = entries.get(profileRef)
    if (hit && opts.now() - hit.at < opts.ttlMs) return hit.person && structuredClone(hit.person)
    if (hit) entries.delete(profileRef)

    let pending = inflight.get(profileRef)
    if (!pending) {
      pending = source.getPerson(profileRef)
      inflight.set(profileRef, pending)
    }
    try {
      const person = await pending
      // "Not found" is an answer too; a failed request isn't, so it's not kept.
      entries.set(profileRef, { person, at: opts.now() })
      while (entries.size > opts.max) entries.delete(entries.keys().next().value!)
      return person && structuredClone(person)
    } finally {
      inflight.delete(profileRef)
    }
  }

  return { ...source, getPerson }
}
