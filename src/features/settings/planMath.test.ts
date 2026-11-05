import { describe, expect, it } from 'vitest'
import type { CatalogueAddon, CatalogueKind } from '../../server/managedBilling'
import { addonPrice, addonsOn, capped, formatPence, kindAmount, monthlyPence, nearestStep, planChanges, unitPrice } from './planMath'

const kinds: CatalogueKind[] = [
  { id: 'prospects', name: 'Prospects', unit: 'person found', per: 1, steps: [0, 100, 500, 1000, 2000], unitMillipence: 900 },
  { id: 'reveals', name: 'Email reveals', unit: 'email found', per: 1, steps: [0, 50, 100, 250, 600, 1000], unitMillipence: 200, maxShareOf: { kind: 'prospects', share: 0.6 } },
  { id: 'emails', name: 'Emails sent', unit: 'email sent', per: 1000, steps: [0, 1000, 10000], unitMillipence: 15 },
]
const addons: CatalogueAddon[] = [
  { id: 'warmup', name: 'Inbox warmup', unit: 'one sender warmed with up to 20 emails a day', unitMillipence: 500_000, available: true, note: null },
]

describe('plan maths', () => {
  it('finds the nearest step for an amount bought before the steps changed', () => {
    expect(nearestStep([0, 100, 500, 1000], 480)).toBe(2)
    expect(nearestStep([0, 100, 500, 1000], 1000)).toBe(3)
  })

  it('caps reveals at their share of prospects, on a step', () => {
    expect(capped({ prospects: 500, reveals: 1000, emails: 0 }, kinds)).toEqual({ prospects: 500, reveals: 250, emails: 0 })
    expect(capped({ prospects: 1000, reveals: 600, emails: 0 }, kinds).reveals).toBe(600)
    expect(capped({ prospects: 0, reveals: 50, emails: 0 }, kinds).reveals).toBe(0)
  })

  it('prices a plan per month, and shows unit prices as people read them', () => {
    expect(monthlyPence({ prospects: 1000, reveals: 250, emails: 10000 }, kinds)).toBe(900 + 50 + 150)
    expect(formatPence(1100)).toBe('£11.00')
    expect(unitPrice(kinds[0])).toBe('£0.009 each')
    expect(unitPrice(kinds[2])).toBe('£0.15 per 1,000')
    // A plan the host bills in dollars: its amounts are cents.
    expect(formatPence(1500, 'USD')).toBe('$15.00')
    expect(unitPrice({ ...kinds[0], unitMillipence: 600 }, 'USD')).toBe('$0.006 each')
    expect(unitPrice({ ...kinds[2], unitMillipence: 25 }, 'USD')).toBe('$0.25 per 1,000')
  })

  it('says what goes up and what goes down', () => {
    expect(planChanges({ prospects: 1000, reveals: 250, emails: 10000 }, { prospects: 2000, reveals: 250, emails: 1000 })).toEqual({
      up: [{ kind: 'prospects', from: 1000, to: 2000 }],
      down: [{ kind: 'emails', from: 10000, to: 1000 }],
    })
    expect(planChanges(null, { prospects: 100, reveals: 0, emails: 0 }).up).toHaveLength(1)
  })

  it('adds a ticked add-on to the monthly price, and counts one an older host leaves out as off', () => {
    expect(monthlyPence({ prospects: 1000, reveals: 0, emails: 10000, warmup: 1 }, kinds, addons)).toBe(900 + 150 + 500)
    expect(monthlyPence({ prospects: 1000, reveals: 0, emails: 10000, warmup: 0 }, kinds, addons)).toBe(900 + 150)
    expect(monthlyPence({ prospects: 1000, reveals: 0, emails: 10000 }, kinds, addons)).toBe(900 + 150)
    // A host that sells no add-ons: a plan's warmup isn't priced here.
    expect(monthlyPence({ prospects: 1000, reveals: 0, emails: 10000, warmup: 1 }, kinds)).toBe(900 + 150)
    expect(addonPrice(addons[0])).toBe('£5.00 a month')
    expect(addonPrice({ ...addons[0], unitMillipence: 700_000 }, 'USD')).toBe('$7.00 a month')
    expect(addonsOn({ prospects: 0, reveals: 0, emails: 0, warmup: 1 }, addons).map((a) => a.name)).toEqual(['Inbox warmup'])
    expect(addonsOn({ prospects: 0, reveals: 0, emails: 0 }, addons)).toEqual([])
  })

  it('counts an add-on ticked as going up (now) and unticked as going down (from renewal)', () => {
    const plan = { prospects: 1000, reveals: 0, emails: 10000 }
    expect(planChanges(plan, { ...plan, warmup: 1 })).toEqual({ up: [{ kind: 'warmup', from: 0, to: 1 }], down: [] })
    expect(planChanges({ ...plan, warmup: 1 }, { ...plan, emails: 20000, warmup: 0 })).toEqual({
      up: [{ kind: 'emails', from: 10000, to: 20000 }],
      down: [{ kind: 'warmup', from: 1, to: 0 }],
    })
    expect(planChanges({ ...plan, warmup: 1 }, { ...plan, warmup: 1 })).toEqual({ up: [], down: [] })
    // Left out of the new plan (no add-ons in the catalogue): it stays as it is.
    expect(planChanges({ ...plan, warmup: 1 }, plan)).toEqual({ up: [], down: [] })
    expect(planChanges(null, { ...plan, warmup: 1 }).up.map((c) => c.kind)).toEqual(['prospects', 'emails', 'warmup'])
  })

  it('prices an AI budget as money a month, and keeps one an older host leaves out', () => {
    const ai: CatalogueKind = { id: 'ai', name: 'AI budget', unit: 'of the copilot a month', per: 1, steps: [0, 5, 10, 20], unitMillipence: 100_000 }
    expect(kindAmount(ai, 10, 'GBP')).toBe('£10 a month')
    expect(kindAmount(ai, 5, 'USD')).toBe('$5 a month')
    expect(kindAmount(kinds[0], 1250)).toBe('1,250')
    const plan = { prospects: 1000, reveals: 0, emails: 0, ai: 10 }
    // 1,000 × £0.009 + £10.
    expect(monthlyPence(plan, [...kinds, ai])).toBe(1900)
    // A host that doesn't list it: the budget isn't priced here, and a plan without it changes nothing.
    expect(monthlyPence(plan, kinds)).toBe(900)
    expect(planChanges(plan, { prospects: 1000, reveals: 0, emails: 0 })).toEqual({ up: [], down: [] })
    expect(planChanges(plan, { ...plan, ai: 20 }).up).toEqual([{ kind: 'ai', from: 10, to: 20 }])
  })
})
