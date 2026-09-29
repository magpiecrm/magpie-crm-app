import { describe, expect, it } from 'vitest'
import type { CatalogueKind } from '../../server/managedBilling'
import { capped, formatPence, monthlyPence, nearestStep, planChanges, unitPrice } from './planMath'

const kinds: CatalogueKind[] = [
  { id: 'prospects', name: 'Prospects', unit: 'person found', per: 1, steps: [0, 100, 500, 1000, 2000], unitMillipence: 900 },
  { id: 'reveals', name: 'Email reveals', unit: 'email found', per: 1, steps: [0, 50, 100, 250, 600, 1000], unitMillipence: 200, maxShareOf: { kind: 'prospects', share: 0.6 } },
  { id: 'emails', name: 'Emails sent', unit: 'email sent', per: 1000, steps: [0, 1000, 10000], unitMillipence: 15 },
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
  })

  it('says what goes up and what goes down', () => {
    expect(planChanges({ prospects: 1000, reveals: 250, emails: 10000 }, { prospects: 2000, reveals: 250, emails: 1000 })).toEqual({
      up: [{ kind: 'prospects', from: 1000, to: 2000 }],
      down: [{ kind: 'emails', from: 10000, to: 1000 }],
    })
    expect(planChanges(null, { prospects: 100, reveals: 0, emails: 0 }).up).toHaveLength(1)
  })
})
