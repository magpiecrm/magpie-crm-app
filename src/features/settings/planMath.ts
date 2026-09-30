// Plan arithmetic for Settings → Plan and billing, from the host's catalogue
// (what it sells, in which steps, at what unit price). Pure, so it's tested
// on its own and the page only draws it.

import type { CatalogueKind, Plan, PlanKind } from '../../server/managedBilling'

export const PLAN_KINDS: PlanKind[] = ['prospects', 'reveals', 'emails']

/** The position of the step nearest `n` (a plan bought before the steps changed lands on the closest). */
export function nearestStep(steps: number[], n: number): number {
  return steps.reduce((best, v, i) => (Math.abs(v - n) < Math.abs(steps[best] - n) ? i : best), 0)
}

/** The plan with any kind capped by its share of another (reveals: at most 30% of prospect credits), on a step. */
export function capped(plan: Plan, kinds: CatalogueKind[]): Plan {
  const out = { ...plan }
  for (const kind of kinds) {
    if (!kind.maxShareOf) continue
    const cap = Math.floor(out[kind.maxShareOf.kind] * kind.maxShareOf.share)
    if (out[kind.id] <= cap) continue
    out[kind.id] = [...kind.steps].reverse().find((s) => s <= cap) ?? 0
  }
  return out
}

/** The monthly price in pence (unit prices are in thousandths of a penny). */
export function monthlyPence(plan: Plan, kinds: CatalogueKind[]): number {
  return kinds.reduce((sum, k) => sum + (plan[k.id] * k.unitMillipence) / 1000, 0)
}

export function formatPence(pence: number, currency = 'GBP'): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency, minimumFractionDigits: 2 })
}

/** A unit price as people read it: "£0.009 each", or "£1.50 per 1,000". */
export function unitPrice(kind: CatalogueKind, currency = 'GBP'): string {
  const pounds = (kind.unitMillipence * kind.per) / 100_000
  const text = pounds.toLocaleString('en-GB', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 })
  return kind.per === 1 ? `${text} each` : `${text} per ${kind.per.toLocaleString('en-GB')}`
}

export interface PlanChange {
  kind: PlanKind
  from: number
  to: number
}

/** What goes up (applies now, charged for the rest of the period) and what goes down (from renewal). */
export function planChanges(current: Plan | null, next: Plan): { up: PlanChange[]; down: PlanChange[] } {
  const up: PlanChange[] = []
  const down: PlanChange[] = []
  for (const kind of PLAN_KINDS) {
    const from = current?.[kind] ?? 0
    const to = next[kind]
    if (to > from) up.push({ kind, from, to })
    else if (to < from) down.push({ kind, from, to })
  }
  return { up, down }
}
