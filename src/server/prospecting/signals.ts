// Intent signals: signs that a company, or a person there, may be in the
// market now, shown as badges on prospect search results and usable as a
// filter. On its own (no database, no network) so the host can use it too.
//
//   warm         the workspace's own email, forms or proposals found interest
//                at the company (warmAccounts.ts)
//   new_in_role  the person started their job lately, from their profile
//   hiring, funding, growing   from the web and LinkedIn's company pages
//
// A person's start date is held in memory with the rest of their search
// result and never saved, sent or logged: the badge is all that's shown.

import type { Signal, SignalKind } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** How recent a start makes someone new in role, where the month is known. */
export const NEW_IN_ROLE_MONTHS = 6

/**
 * A start date as a profile gives it (2021, "2021", "2021-03", "2021-03-15")
 * as a year or a month, never the day; null for anything else.
 */
export function monthOf(value: unknown, now = new Date()): string | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  const m = text.match(/^(\d{4})(?:-(\d{1,2}))?(?:-\d{1,2})?(?:T.*)?$/)
  if (!m) return null
  const year = Number(m[1])
  if (year < 1950 || year > now.getUTCFullYear() + 1) return null
  if (!m[2]) return String(year)
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : String(year)
}

/**
 * "New in role" from when they started: within NEW_IN_ROLE_MONTHS where the
 * month is known; where only the year is, a start this year (the badge then
 * says the year, so it doesn't claim more than it knows).
 */
export function newInRoleSignal(startedOn: string | null | undefined, now = new Date()): Signal | null {
  const m = startedOn?.match(/^(\d{4})(?:-(\d{2}))?$/)
  if (!m) return null
  const year = Number(m[1])
  if (!m[2]) {
    return year === now.getUTCFullYear() ? { kind: 'new_in_role', label: `New in role · started ${year}`, at: m[1], source: 'linkedin' } : null
  }
  const month = Number(m[2])
  const ago = (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month)
  if (ago < 0 || ago > NEW_IN_ROLE_MONTHS) return null
  return { kind: 'new_in_role', label: `New in role · since ${MONTHS[month - 1]} ${year}`, at: startedOn!, source: 'linkedin' }
}

/**
 * What a company's signals are filed under: its domain, or its name where the
 * domain isn't known. Not its country: a person's country and their
 * employer's can differ, and the same company must find the same answer.
 */
export function signalKey(c: { domain?: string | null; name?: string | null }): string | null {
  const domain = c.domain?.trim().toLowerCase().replace(/^www\./, '')
  if (domain) return domain
  const name = (c.name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(ltd|limited|llc|inc|plc|gmbh|corp|corporation|co|group|holdings|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name ? `name:${name}` : null
}

/** Signals added to what's there, one of each kind: a later one of a kind replaces the earlier. */
export function withSignals<T extends { signals?: Signal[] }>(target: T, signals: Array<Signal | null | undefined>): T {
  const fresh = signals.filter((s): s is Signal => Boolean(s))
  if (!fresh.length) return target
  const kept = (target.signals ?? []).filter((s) => !fresh.some((f) => f.kind === s.kind))
  return { ...target, signals: [...kept, ...fresh] }
}

/** Whether a result has any of these kinds. */
export const hasSignal = (target: { signals?: Signal[] }, kinds: readonly SignalKind[]) => Boolean(target.signals?.some((s) => kinds.includes(s.kind)))

/** How strong a set of signals is, for sorting results: warm counts most, as it's the workspace's own. */
const WEIGHT: Record<SignalKind, number> = { warm: 5, new_in_role: 3, hiring: 3, funding: 3, growing: 2 }
export const signalScore = (signals: Signal[] | undefined) => (signals ?? []).reduce((n, s) => n + WEIGHT[s.kind], 0)
