// Usage counts: what this copy of the app has used, by month and by UTC day,
// for the Settings overview and, when USAGE_API_TOKEN is set, for GET
// /api/usage (e.g. a hosting provider's billing, or its figures for the last
// day or week). Counts only, never who or what.
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
  /**
   * Where prospect credits go (search yield): profiles looked up during search
   * (3 credits each), and of those, people then left out because they turned
   * out to work elsewhere, to be a contact already, or (hidden while
   * verified-only is on) to be at a company where no email can be verified.
   */
  'searchProfiles',
  'searchPaidWrongCompany',
  'searchPaidInContacts',
  'searchPaidUnverifiable',
  /**
   * People left out before their profile was paid for, from what the search
   * hit already says: a company known to be unverifiable, an existing
   * contact, or a headline saying they've left ("Former …").
   */
  'searchSkippedUnverifiable',
  'searchSkippedContact',
  'searchSkippedNotWorking',
  /** Companies first: their headline names an employer that isn't one of the companies searched (they've moved on). */
  'searchSkippedOtherEmployer',
  /** People shown without a profile lookup: found inside the one company searched, which says where they work. */
  'searchNoLookup',
  /**
   * Searches by company size (companies first): company searches paid for,
   * companies found, and of those, ones left out before searching people
   * there because no email can be verified (catch-all or no mail), and ones
   * searched without a known domain (SocialFetch's search often omits it).
   */
  'searchOrgRequests',
  'searchCompaniesFound',
  'searchCompaniesUnverifiable',
  'searchCompaniesNoDomain',
  /**
   * Checks our own verification limits held back (recordLimit), by limit: the
   * per-minute pace, a company checked a lot in the last few minutes (both
   * wait and try again, so they aren't finished lookups), today's cap, paused
   * or benched verification IPs, and a company that has rejected many guesses
   * today.
   */
  'limitPace',
  'limitCompanyPace',
  'limitDailyCap',
  'limitPaused',
  'limitCompanyRejections',
  /** Email lookups run, by Reveal or when saving prospects. */
  'emailLookups',
  /** Addresses handed over: revealed, or saved as a new contact. */
  'emailsFound',
  /** New contacts created from prospect search. */
  'contactsSaved',
  /** People in search results whose job and employer came from the host's shared database (sharedPeople.ts). */
  'sharedPeople',
  /** Emails the host's shared database gave free, so they aren't in `emailsFound`. */
  'sharedEmails',
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
export const dayOf = (date: Date) => date.toISOString().slice(0, 10)

function flush() {
  clearTimeout(g.__usageTimer)
  g.__usageTimer = null
  try {
    // Pending counts are kept by day; each goes to its month and its day.
    for (const [day, deltas] of pending) db.addUsage(day.slice(0, 7), deltas, day)
  } catch (err: any) {
    // Counting must never break the search, save or send that triggered it.
    console.error('[Usage] Failed to save usage counts:', err?.message ?? err)
  }
  pending.clear()
}

// The production server (serve.ts) calls this on shutdown, so counts still
// waiting to be written aren't lost.
g.__usageFlush = flush

/** Counts a check our verification limits held back, by which limit. */
export function recordLimit(code: string, now = new Date()) {
  const counter = ({ busy: 'limitPace', company_pace: 'limitCompanyPace', daily_cap: 'limitDailyCap', paused: 'limitPaused', benched: 'limitPaused', domain_rejections: 'limitCompanyRejections' } as const)[code as 'busy']
  if (counter) recordUsage({ [counter]: 1 }, now)
}

/** Counts how one email lookup ended. */
export function recordLookup(outcome: LookupOutcome, now = new Date()) {
  recordUsage({ [lookupCounter(outcome)]: 1 }, now)
}

/** Adds to this month's (and today's) counts. */
export function recordUsage(deltas: Partial<UsageCounts>, now = new Date()) {
  const day = dayOf(now)
  const row = pending.get(day) ?? {}
  for (const [key, n] of Object.entries(deltas) as Array<[UsageCounter, number]>) {
    if (n) row[key] = (row[key] ?? 0) + n
  }
  pending.set(day, row)
  // Straight away, so the next search or send already sees what's left.
  countAgainstAllowance({ prospects: deltas.prospectCredits, reveals: deltas.emailsFound, emailsSent: deltas.emailsSent })
  // unref: a pending count must not keep the process (or a test run) alive.
  g.__usageTimer ??= setTimeout(flush, FLUSH_MS).unref?.() ?? null
}

const complete = (row: Partial<UsageCounts> | undefined): UsageCounts =>
  Object.fromEntries(USAGE_COUNTERS.map((k) => [k, row?.[k] ?? 0])) as UsageCounts

/**
 * Lookup outcomes where no mail server could have been asked: no mail
 * domain, no company domain, a hidden surname or unusable name, a
 * verification limit, or verification switched off. Left out of the hit
 * rate, which should only move when finding addresses gets better or worse.
 */
const UNCHECKABLE: LookupOutcome[] = ['noMail', 'noDomain', 'hiddenSurname', 'badName', 'limit', 'unchecked']

/**
 * Verified lookups out of those that reached a mail server. `rate` is null
 * with none of those yet. Catch-all companies count as misses, including
 * those with a confirmed format (`formatConfirmed`, counted separately:
 * handed over when allowed, but never verified).
 */
export function lookupHitRate(counts: UsageCounts): { verified: number; formatConfirmed: number; checkable: number; rate: number | null } {
  const checkable = LOOKUP_OUTCOMES.filter((o) => !UNCHECKABLE.includes(o)).reduce((n, o) => n + counts[lookupCounter(o)], 0)
  const verified = counts.lookupVerified
  return { verified, formatConfirmed: counts.lookupFormatConfirmed, checkable, rate: checkable ? verified / checkable : null }
}

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

/**
 * The counts from `from` to `to` (UTC days, both included), and the first day
 * daily counts were kept: a period starting before then is only partly
 * counted (copies before daily counts only kept months).
 */
export function usageBetween(from: string, to: string): { counts: UsageCounts; countedSince: string | null } {
  flush()
  const daily = db.getDailyUsage()
  const days = Object.keys(daily).sort()
  const sum: Partial<UsageCounts> = {}
  for (const day of days) {
    if (day < from || day > to) continue
    for (const [key, n] of Object.entries(daily[day]) as Array<[UsageCounter, number]>) sum[key] = (sum[key] ?? 0) + n
  }
  return { counts: complete(sum), countedSince: days[0] ?? null }
}
