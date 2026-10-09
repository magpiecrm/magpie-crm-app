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
import type { MailProvider } from './proxyRouter'

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
  /** This copy's share of the host's verification, to pace its checks to (runtime.ts). */
  checks: CheckShare | null
  /** Daily sending limits the host has set for this copy itself, in place of the ramp (sendingLimits.ts). */
  sendLimits: SendLimits | null
  /** The host's shared database of business contacts (sharedPeople.ts); null when it has none, or it isn't open. */
  pool: SharedDatabase | null
}

export interface SharedDatabase {
  /** Whether this copy sends it the verified contacts it saves from prospect search. */
  contributing: boolean
  /** The Contributor Terms someone here agrees to when joining, and where to read them. */
  termsVersion: string
  termsUrl: string | null
}

/** Emails a day of each kind; a kind left out follows the ramp. */
export interface SendLimits {
  cold?: number
  optIn?: number
}

export interface CheckShare {
  perMinute: number
  perDay: number
  /** Per mail provider, what the host's IPs can take a minute, at most `perMinute`. */
  perProvider?: Record<MailProvider, number>
}

const TIMEOUT_MS = 5_000
// globalThis so the answer survives Vite's module re-evaluation on HMR.
const g = globalThis as { __hostRules?: HostAnswer }

const whole = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : null)

function checkShareFrom(c: any): CheckShare | null {
  const perMinute = whole(c?.perMinute)
  const perDay = whole(c?.perDay)
  if (!perMinute || !perDay) return null
  const p = c?.perProvider
  const google = whole(p?.google)
  const microsoft = whole(p?.microsoft)
  const other = whole(p?.other)
  return {
    perMinute,
    perDay,
    ...(google && microsoft && other ? { perProvider: { google: Math.min(google, perMinute), microsoft: Math.min(microsoft, perMinute), other: Math.min(other, perMinute) } } : {}),
  }
}

const inRange = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback

function sendLimitsFrom(l: any): SendLimits | null {
  const limit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000 ? Math.floor(v) : undefined)
  const cold = limit(l?.cold)
  const optIn = limit(l?.optIn)
  return cold === undefined && optIn === undefined ? null : { ...(cold !== undefined ? { cold } : {}), ...(optIn !== undefined ? { optIn } : {}) }
}

function sharedDatabaseFrom(p: any): SharedDatabase | null {
  if (p?.available !== true || typeof p.termsVersion !== 'string') return null
  const termsUrl = typeof p.termsUrl === 'string' && /^https:\/\//.test(p.termsUrl) ? p.termsUrl : null
  return { contributing: p.contributing === true, termsVersion: p.termsVersion, termsUrl }
}

/** Daily sending limits the host set for this copy, if any. */
export function hostSendLimits(): SendLimits | null {
  return env.sendingManaged() ? (g.__hostRules?.sendLimits ?? null) : null
}

export function prospectingRules(): ProspectingRules {
  return g.__hostRules?.rules ?? DEFAULT_RULES
}

/**
 * This copy's share of its host's verification, checks per minute and per
 * day, or null before the host has said (or outside a hosted copy).
 */
export function hostCheckShare(): CheckShare | null {
  return env.prospectingManaged() ? (g.__hostRules?.checks ?? null) : null
}

/** Whether this copy reports and asks for company email formats: hosted, and not left out. */
export function formatSharingOn(): boolean {
  return env.prospectingManaged() && g.__hostRules?.formatSharing === true
}

/** The host's shared database, when it has one open to this copy. */
export function sharedDatabase(): SharedDatabase | null {
  return env.prospectingManaged() ? (g.__hostRules?.pool ?? null) : null
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
      checks: checkShareFrom(body?.checks),
      sendLimits: sendLimitsFrom(body?.sendLimits),
      pool: sharedDatabaseFrom(body?.pool),
    }
    g.__hostRules = answer
    return answer
  } catch {
    return null
  }
}
