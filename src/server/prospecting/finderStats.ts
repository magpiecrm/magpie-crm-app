// What the email finder's verified finds looked like, counted by month for
// tuning its guesses (patterns.ts): which candidate and format verified, by
// the company's size, and how lookups ended by the shape of the name. Kinds
// and counts only, never a name, address or company, and kept apart from
// the search log so nothing in it can be tied to one search.

import type { FindResult } from './emailFinder'
import { nameShapes } from './patterns'

const bucket = (headcount: number | null | undefined) => (!headcount ? 'unknown' : headcount <= 10 ? '1-10' : headcount <= 50 ? '11-50' : '51+')

export async function recordFinderStats(person: { firstName: string; lastName: string }, found: FindResult, headcount: number | null | undefined, now = new Date()) {
  try {
    const deltas: Record<string, number> = {}
    const add = (key: string) => void (deltas[key] = (deltas[key] ?? 0) + 1)
    if (found.verifiedAt) {
      const { ranked, pattern, index } = found.verifiedAt
      add(`verified|${bucket(headcount)}|${ranked}|${pattern}`)
      add(`verifiedAt|${ranked}|${index}`)
    }
    for (const shape of nameShapes(person.firstName, person.lastName)) add(`shape|${shape}|${found.outcome}`)
    const { db } = await import('../db')
    db.addFinderStats(now.toISOString().slice(0, 7), deltas)
  } catch (err: any) {
    console.error('[EmailFinder] Failed to count a lookup:', err?.message ?? err)
  }
}
