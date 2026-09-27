// Monthly usage counts: what this copy of the app has used, for the Settings
// overview and, when USAGE_API_TOKEN is set, for GET /api/usage (e.g. a
// hosting provider's billing). Counts only, never who or what.
//
// Increments are gathered in memory and written a couple of seconds later in
// one go, so sending a campaign doesn't rewrite the database once per email.

import { countAgainstAllowance } from './allowance'
import { db } from './db'
import { LOOKUP_OUTCOMES, type LookupOutcome } from './prospecting/types'

/** The counter for one lookup outcome: `verified` → `lookupVerified`. */
const lookupCounter = <O extends LookupOutcome>(outcome: O) =>
  `lookup${outcome[0].toUpperCase()}${outcome.slice(1)}` as `lookup${Capitalize<O>}`

const USAGE_COUNTERS = [
  /** SocialFetch people-search pages run (3 credits each). */
  'searches',
  /** People shown in prospect search results. */
  'prospects',
  /**
   * What searches cost, in prospect credits (allowance.ts; to the hundredth):
   * this is what a plan's prospect allowance counts.
   */
  'prospectCredits',
  /** Email lookups run, by Reveal or when saving prospects. */
  'emailLookups',
  /** Addresses handed over: revealed, or saved as a new contact. */
  'emailsFound',
  /** New contacts created from prospect search. */
  'contactsSaved',
  /** Emails accepted by the sending provider (campaigns, tests and one-offs). */
  'emailsSent',
  /**
   * How each finished email lookup ended (by Reveal or when saving), one
   * counter per outcome: `lookupVerified`, and the reasons no address was
   * confirmed (`lookupCatchAll`, `lookupRejected`, …). Their total is every
   * lookup, so verified ÷ total is the hit rate.
   */
  ...LOOKUP_OUTCOMES.map(lookupCounter),
] as const

export type UsageCounter = (typeof USAGE_COUNTERS)[number]
export type UsageCounts = Record<UsageCounter, number>

const FLUSH_MS = 2_000

// globalThis so pending counts survive Vite's module re-evaluation on HMR.
const g = globalThis as any
const pending: Map<string, Partial<UsageCounts>> = (g.__usagePending ??= new Map())

export const monthOf = (date: Date) => date.toISOString().slice(0, 7)

function flush() {
  clearTimeout(g.__usageTimer)
  g.__usageTimer = null
  try {
    for (const [month, deltas] of pending) db.addUsage(month, deltas)
  } catch (err: any) {
    // Counting must never break the search, save or send that triggered it.
    console.error('[Usage] Failed to save usage counts:', err?.message ?? err)
  }
  pending.clear()
}

// The production server (serve.ts) calls this on shutdown, so counts still
// waiting to be written aren't lost.
g.__usageFlush = flush

/** Counts how one email lookup ended. */
export function recordLookup(outcome: LookupOutcome, now = new Date()) {
  recordUsage({ [lookupCounter(outcome)]: 1 }, now)
}

/** Adds to this month's counts. */
export function recordUsage(deltas: Partial<UsageCounts>, now = new Date()) {
  const month = monthOf(now)
  const row = pending.get(month) ?? {}
  for (const [key, n] of Object.entries(deltas) as Array<[UsageCounter, number]>) {
    if (n) row[key] = (row[key] ?? 0) + n
  }
  pending.set(month, row)
  // Straight away, so the next search or send already sees what's left.
  countAgainstAllowance({ prospects: deltas.prospectCredits, reveals: deltas.emailsFound, emailsSent: deltas.emailsSent })
  // unref: a pending count must not keep the process (or a test run) alive.
  g.__usageTimer ??= setTimeout(flush, FLUSH_MS).unref?.() ?? null
}

const complete = (row: Partial<UsageCounts> | undefined): UsageCounts =>
  Object.fromEntries(USAGE_COUNTERS.map((k) => [k, row?.[k] ?? 0])) as UsageCounts

/** Every month with usage, oldest first, each with every counter. */
export function getUsage(): Array<{ month: string } & UsageCounts> {
  flush()
  return Object.entries(db.getUsage())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, row]) => ({ month, ...complete(row) }))
}

export function usageForMonth(month: string): UsageCounts {
  flush()
  return complete(db.getUsage()[month])
}
