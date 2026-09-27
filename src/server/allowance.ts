// Monthly allowances: how many prospects, email reveals and sent emails this
// copy may use in the current billing period, for a host that sells usage up
// front (e.g. MagpieCRM Cloud). Unset — the default, and for self-hosting —
// means no limits.
//
// The host sets them with PUT /api/usage/allowance (USAGE_API_TOKEN):
//   { "periodStart": "2026-10-15T00:00:00Z", "periodEnd": "…",
//     "prospects": 500, "reveals": 1500, "emailsSent": 10000,
//     "upgradeUrl": "https://…" }
// A new periodStart starts the counts again from zero (unused allowance doesn't
// roll over); the same periodStart with bigger numbers is an upgrade, keeping
// what's been used. Each allowance stops only its own action: out of prospects,
// search stops but reveals and sending still work.

import { db } from './db'

export const ALLOWANCE_KINDS = ['prospects', 'reveals', 'emailsSent'] as const
export type AllowanceKind = (typeof ALLOWANCE_KINDS)[number]

export interface Allowance {
  periodStart: string
  periodEnd: string | null
  /** A missing kind has no limit. */
  limits: Partial<Record<AllowanceKind, number>>
  used: Record<AllowanceKind, number>
  /** Where the Upgrade button goes. */
  upgradeUrl: string | null
  /** The host has paused this copy's sending (e.g. too many spam complaints); everything else works. */
  sendingPaused?: boolean
}

const WHAT: Record<AllowanceKind, [one: string, many: string]> = {
  prospects: ['prospect', 'prospects'],
  reveals: ['email reveal', 'email reveals'],
  emailsSent: ['email', 'emails'],
}

const fmt = (n: number) => n.toLocaleString('en-GB')
const noun = (kind: AllowanceKind, n: number) => WHAT[kind][n === 1 ? 0 : 1]

/** Used when an action would go over its allowance; the message is for the user. */
export class AllowanceError extends Error {
  constructor(
    readonly kind: AllowanceKind,
    message: string,
    readonly upgradeUrl: string | null,
  ) {
    super(message)
    this.name = 'AllowanceError'
  }
}

export function getAllowance(): Allowance | null {
  return db.getAllowance()
}

/** Sets (or, with null, removes) the allowance for this billing period. */
export function setAllowance(
  input: { periodStart: string; periodEnd?: string | null; upgradeUrl?: string | null; sendingPaused?: boolean } &
    Partial<Record<AllowanceKind, number | null>>,
): Allowance | null {
  const current = db.getAllowance()
  const limits: Allowance['limits'] = {}
  for (const kind of ALLOWANCE_KINDS) {
    const n = input[kind]
    if (typeof n === 'number') limits[kind] = n
  }
  const samePeriod = current?.periodStart === input.periodStart
  const next: Allowance = {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd ?? null,
    limits,
    used: samePeriod ? current!.used : { prospects: 0, reveals: 0, emailsSent: 0 },
    upgradeUrl: input.upgradeUrl ?? null,
    ...(input.sendingPaused ? { sendingPaused: true } : {}),
  }
  db.setAllowance(next)
  return next
}

export function clearAllowance() {
  db.setAllowance(null)
}

/** How many more of `kind` may be used this period; Infinity when there's no limit. */
export function remaining(kind: AllowanceKind): number {
  const a = db.getAllowance()
  if (kind === 'emailsSent' && a?.sendingPaused) return 0
  const limit = a?.limits[kind]
  if (!a || limit === undefined) return Infinity
  return Math.max(0, limit - a.used[kind])
}

/**
 * Throws an AllowanceError unless `n` more of `kind` fit in this period's
 * allowance. `action` is how the message starts when only part fits, e.g.
 * "Sending this campaign".
 */
export function requireAllowance(kind: AllowanceKind, n = 1, action?: string) {
  const left = remaining(kind)
  if (n <= left) return
  const a = db.getAllowance()!
  if (kind === 'emailsSent' && a.sendingPaused) {
    throw new AllowanceError(kind, 'Sending is paused on this workspace by your hosting provider. Contact them to find out why.', null)
  }
  const limit = a.limits[kind]!
  const message =
    left === 0 || !action
      ? `You've used all ${fmt(limit)} ${noun(kind, limit)} in your plan this month. Upgrade to get more.`
      : `${action} needs ${fmt(n)} ${noun(kind, n)}, but your plan has ${fmt(left)} left this month. Upgrade to get more.`
  throw new AllowanceError(kind, message, a.upgradeUrl)
}

/** Counts usage against the allowance (called with every usage count; see usage.ts). */
export function countAgainstAllowance(deltas: Partial<Record<AllowanceKind, number>>) {
  const a = db.getAllowance()
  if (!a) return
  for (const kind of ALLOWANCE_KINDS) {
    const n = deltas[kind]
    if (n) a.used[kind] += n
  }
  // Saved with the usage counts a moment later (usage.ts flush).
}
