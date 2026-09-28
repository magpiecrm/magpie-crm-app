// How this copy treats addresses that can't be verified: when a company's
// format counts as confirmed, and how campaigns hold unverified addresses
// back (guessedRecipients.ts). A hosted copy (PROSPECTING_MANAGED) reads them
// from its host, which sets them in its admin portal:
//
//   GET {REACHER_URL}/v1/prospecting  (x-reacher-secret)
//     → { rules, formatSharing, eventsPending }
//
// refreshed every 10 minutes by the email scheduler. Anywhere else, and until
// the host first answers, the defaults below apply.

import { env } from '../env'

export interface ProspectingRules {
  /** Confidence at which a guess at a catch-all company is `format_confirmed`. */
  formatConfirmed: number
  /** Unverified addresses a campaign sends before holding the rest. */
  firstBatch: number
  /** Least time the rest are held for. */
  holdHours: number
  /** Hard-bounce share of the first batch above which the rest stay held. */
  maxBounceRate: number
}

export const DEFAULT_RULES: ProspectingRules = { formatConfirmed: 0.85, firstBatch: 50, holdHours: 1, maxBounceRate: 0.02 }

/** What the host said last. */
interface HostAnswer {
  rules: ProspectingRules
  /** Whether this copy takes part in sharing company email formats (sharedFormats.ts). */
  formatSharing: boolean
  /** Bounces from the host's mail server are still on their way to this copy. */
  eventsPending: boolean
}

const TIMEOUT_MS = 5_000
// globalThis so the answer survives Vite's module re-evaluation on HMR.
const g = globalThis as { __hostRules?: HostAnswer }

const inRange = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback

export function prospectingRules(): ProspectingRules {
  return g.__hostRules?.rules ?? DEFAULT_RULES
}

/** Whether this copy reports and asks for company email formats: hosted, and not left out. */
export function formatSharingOn(): boolean {
  return env.prospectingManaged() && g.__hostRules?.formatSharing === true
}

/**
 * Asks the host for its rules now. Null outside a hosted copy, or when the
 * host doesn't answer (the last answer, or the defaults, stay in use).
 */
export async function refreshHostRules(fetchImpl: typeof fetch = fetch): Promise<HostAnswer | null> {
  const url = env.reacher.url()
  const secret = env.reacher.secret()
  if (!env.prospectingManaged() || !url || !secret) return null
  try {
    const res = await fetchImpl(`${url}/v1/prospecting`, { headers: { 'x-reacher-secret': secret }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const body = (await res.json()) as any
    const r = body?.rules ?? {}
    const answer: HostAnswer = {
      rules: {
        formatConfirmed: inRange(r.formatConfirmed, 0.75, 0.99, DEFAULT_RULES.formatConfirmed),
        firstBatch: Math.round(inRange(r.firstBatch, 10, 1000, DEFAULT_RULES.firstBatch)),
        holdHours: inRange(r.holdHours, 0.5, 72, DEFAULT_RULES.holdHours),
        maxBounceRate: inRange(r.maxBounceRate, 0, 0.1, DEFAULT_RULES.maxBounceRate),
      },
      formatSharing: body?.formatSharing === true,
      eventsPending: body?.eventsPending === true,
    }
    g.__hostRules = answer
    return answer
  } catch {
    return null
  }
}
