// What each people search was for and what came of it: its filters, where
// the people it found went (the same counts as the "[Prospecting] Search
// funnel" log line), how long it took, and how the email lookups for the
// people it showed ended. Kept so a workspace's host can see which job
// titles, countries or industries find few people or few emails (GET
// /api/usage/searches).
//
// Filters and counts only: never who was found. Each person a search shows
// carries the search's id (PersonResult.searchId), so a Reveal or a save can
// add its outcome to that search's line; nothing links the line back to them.

import type { LookupOutcome } from './types'

export interface SearchLogEntry {
  id: string
  /** When it finished (ISO). */
  at: string
  /** How long it ran. */
  ms: number
  filters: {
    titles: string[]
    seniorities: string[]
    industries: string[]
    sizes: string[]
    country: string | null
    /** The one company searched inside, by name (company data). */
    company: string | null
    /** Whether a keyword was used; what it was isn't kept. */
    keyword: boolean
    /** The signals asked for (signals.ts), where any were. */
    signals?: string[]
    /** A first page, one carried on from where the last stopped, or Load more. */
    page: 'first' | 'resumed' | 'more'
  }
  /** Where the people found went, as in the funnel log line. */
  counts: Record<string, number>
  /** Why the page stopped searching: full, nothing more, most top-ups, few kept, budget, or a failure. */
  stop?: string
  /** How the email lookups for people this search showed ended, by outcome. */
  lookups: Partial<Record<LookupOutcome, number>>
}

/** A short id for one search: random, and meaning nothing by itself. */
export const newSearchId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

export async function logSearch(entry: Omit<SearchLogEntry, 'lookups'>) {
  try {
    const { db } = await import('../db')
    db.addSearchLog({ ...entry, lookups: {} })
  } catch (err: any) {
    // Keeping the log must never break the search it's about.
    console.error('[Prospecting] Failed to log the search:', err?.message ?? err)
  }
}

/** Adds how one email lookup ended to the search that showed the person, if it's still in the log. */
export async function noteSearchLookup(searchId: string | null | undefined, outcome: LookupOutcome) {
  if (!searchId) return
  try {
    const { db } = await import('../db')
    db.noteSearchLookup(searchId, outcome)
  } catch (err: any) {
    console.error('[Prospecting] Failed to note a lookup against its search:', err?.message ?? err)
  }
}
