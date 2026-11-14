// The demo's plan and usage, so it shows its credits as a customer's copy
// does: the sidebar's meters, Settings → Your plan and Usage this month, and
// Maggy's AI budget. A customer's comes from their host (PUT
// /api/usage/allowance); a demo copy is one of the host's own workspaces, which
// it gives no plan, so the seed writes one, part-used, as if the month were
// under way. Counts only: no person is in any of it.

import type { Allowance } from '../allowance'
import type { UsageCounter } from '../usage'

type Counts = Partial<Record<UsageCounter, number>>

const DAY = 86_400_000

/** A small team's plan, as the website's sliders sell it: £10 of credits, 5,000 emails and £10 of AI a month. */
export const DEMO_PLAN = { prospects: 2_500, emailsSent: 5_000, aiPounds: 10 } as const
/** The AI budget's thousandths of a penny for each pound (the host's AI_MILLI_PER_UNIT). */
const AI_MILLI_PER_POUND = 100_000
/** How far into its month the plan is, so its meters are part-used. */
const DAYS_INTO_PERIOD = 11
/** Daily counts kept back this far, so last month has its numbers too. */
const DAYS_KEPT = 75
const UPGRADE_URL = 'https://magpiecrm.com/pricing'

function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * The plan, and its usage by day and by month, from `now`. Emails sent are
 * the demo's own campaigns' (each recipient row's `sent_at`); searching,
 * lookups and the AI are a small team's working days.
 */
export function buildDemoPlan({ now, sentAt }: { now: Date; sentAt: Array<string | null | undefined> }) {
  const random = prng(20261114)
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  const daily: Record<string, Counts> = {}
  for (let d = DAYS_KEPT; d >= 0; d--) {
    const ms = today - d * DAY
    const weekday = new Date(ms).getUTCDay() % 6 !== 0
    // Today is only part done.
    const share = d === 0 ? 0.4 : 1
    const searches = Math.round((weekday ? int(1, 4) : int(0, 1)) * share)
    const prospects = searches * int(18, 25)
    const emailLookups = Math.round(prospects * (0.25 + random() * 0.15))
    const emailsFound = Math.round(emailLookups * (0.4 + random() * 0.15))
    const aiRequests = Math.round((weekday ? int(4, 14) : int(0, 3)) * share)
    const counts: Counts = {
      searches,
      prospects,
      prospectCredits: prospects,
      emailLookups,
      lookupVerified: emailsFound,
      emailsFound,
      contactsSaved: Math.round(emailsFound * 0.8),
      aiRequests,
      aiCharge: aiRequests * int(1_400, 2_600),
    }
    daily[dayOf(ms)] = counts
  }
  for (const at of sentAt) {
    if (!at || Date.parse(at) > now.getTime() || Date.parse(at) < today - DAYS_KEPT * DAY) continue
    const day = (daily[at.slice(0, 10)] ??= {})
    day.emailsSent = (day.emailsSent ?? 0) + 1
  }

  const monthly: Record<string, Counts> = {}
  for (const [day, counts] of Object.entries(daily)) {
    const month = (monthly[day.slice(0, 7)] ??= {})
    for (const [key, n] of Object.entries(counts) as Array<[UsageCounter, number]>) month[key] = (month[key] ?? 0) + n
  }

  // A month's billing period, begun a few days ago, as a subscription's is.
  const start = new Date(today - DAYS_INTO_PERIOD * DAY)
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()))
  const inPeriod = Object.entries(daily).filter(([day]) => day >= dayOf(start.getTime()))
  const sum = (key: UsageCounter) => inPeriod.reduce((n, [, counts]) => n + (counts[key] ?? 0), 0)
  const allowance: Allowance = {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    limits: { prospects: DEMO_PLAN.prospects, emailsSent: DEMO_PLAN.emailsSent, ai: DEMO_PLAN.aiPounds * AI_MILLI_PER_POUND },
    // Reveals draw on prospect credits (revealCredits), as on every plan sold now.
    used: { prospects: sum('prospectCredits') + sum('emailsFound'), reveals: sum('emailsFound'), emailsSent: sum('emailsSent'), ai: sum('aiCharge') },
    upgradeUrl: UPGRADE_URL,
    revealCredits: 1,
  }
  return { allowance, daily, monthly }
}
