// Plan arithmetic for Settings → Plan and billing, from the host's catalogue
// (what it sells, in which steps, at what unit price). Pure, so it's tested
// on its own and the page only draws it.

import type { CatalogueAddon, CatalogueKind, Plan, PlanAddon, PlanKind } from '../../server/managedBilling'

export const PLAN_KINDS: PlanKind[] = ['prospects', 'reveals', 'emails', 'ai']
/** Kinds bought as an amount of money a month rather than a count (the AI budget). */
export const isBudget = (id: string) => id === 'ai'
export const PLAN_ADDONS: PlanAddon[] = ['warmup']
export const isAddon = (id: string): id is PlanAddon => (PLAN_ADDONS as string[]).includes(id)

/** The add-ons a plan has, as the host's catalogue names them. */
export const addonsOn = (plan: Plan | null, addons: CatalogueAddon[]) => addons.filter((a) => plan?.[a.id] === 1)

/** The position of the step nearest `n` (a plan bought before the steps changed lands on the closest). */
export function nearestStep(steps: number[], n: number): number {
  return steps.reduce((best, v, i) => (Math.abs(v - n) < Math.abs(steps[best] - n) ? i : best), 0)
}

/** The plan with any kind capped by its share of another (reveals: at most 30% of prospect credits), on a step. */
export function capped(plan: Plan, kinds: CatalogueKind[]): Plan {
  const out = { ...plan }
  for (const kind of kinds) {
    if (!kind.maxShareOf) continue
    const cap = Math.floor((out[kind.maxShareOf.kind] ?? 0) * kind.maxShareOf.share)
    if ((out[kind.id] ?? 0) <= cap) continue
    out[kind.id] = [...kind.steps].reverse().find((s) => s <= cap) ?? 0
  }
  return out
}

/**
 * How a currency's amounts are written: dollars the American way ("$15.00"),
 * since British formatting writes them "US$15.00". The host says which
 * currency a plan is in; amounts are in its smallest unit (pence, or cents).
 */
export const moneyLocale = (currency: string) => (currency.toUpperCase() === 'USD' ? 'en-US' : 'en-GB')

/** The monthly price in pence or cents (unit prices are in thousandths of one), add-ons ticked included. */
export function monthlyPence(plan: Plan, kinds: CatalogueKind[], addons: CatalogueAddon[] = []): number {
  return (
    kinds.reduce((sum, k) => sum + ((plan[k.id] ?? 0) * k.unitMillipence) / 1000, 0) +
    addonsOn(plan, addons).reduce((sum, a) => sum + a.unitMillipence / 1000, 0)
  )
}

export function formatPence(pence: number, currency = 'GBP'): string {
  return (pence / 100).toLocaleString(moneyLocale(currency), { style: 'currency', currency, minimumFractionDigits: 2 })
}

/** A unit price as people read it: "£0.009 each", or "£1.50 per 1,000". */
export function unitPrice(kind: CatalogueKind, currency = 'GBP'): string {
  const pounds = (kind.unitMillipence * kind.per) / 100_000
  const text = pounds.toLocaleString(moneyLocale(currency), { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 })
  return kind.per === 1 ? `${text} each` : `${text} per ${kind.per.toLocaleString('en-GB')}`
}

/** An amount of a kind as people read it: "1,250", or for a budget "£10 a month". */
export function kindAmount(kind: CatalogueKind, n: number, currency = 'GBP'): string {
  if (!isBudget(kind.id)) return n.toLocaleString()
  return `${formatPence((n * kind.unitMillipence) / 1000, currency).replace(/\.00$/, '')} a month`
}

/** An add-on's price: "£5.00 a month". */
export const addonPrice = (addon: CatalogueAddon, currency = 'GBP') => `${formatPence(addon.unitMillipence / 1000, currency)} a month`

export interface PlanChange {
  kind: PlanKind | PlanAddon
  /** For an add-on, 1 when it's on. */
  from: number
  to: number
}

/**
 * What goes up (applies now, charged for the rest of the period) and what
 * goes down (from renewal). An add-on ticked is up, unticked down; one the
 * new plan leaves out stays as it is.
 */
export function planChanges(current: Plan | null, next: Plan): { up: PlanChange[]; down: PlanChange[] } {
  const up: PlanChange[] = []
  const down: PlanChange[] = []
  for (const kind of [...PLAN_KINDS, ...PLAN_ADDONS]) {
    const from = current?.[kind] ?? 0
    const to = next[kind] ?? from
    if (to > from) up.push({ kind, from, to })
    else if (to < from) down.push({ kind, from, to })
  }
  return { up, down }
}
