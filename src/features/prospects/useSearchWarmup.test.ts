import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/functions', () => ({ warmPeopleSearchFn: vi.fn(), checkAuthFn: vi.fn() }))
const { shouldWarm, WARM_EVERY_MS } = await import('./useSearchWarmup')

describe('shouldWarm', () => {
  it('asks when the page opens, then every few minutes at most', () => {
    expect(shouldWarm(true, true, null, 1_000)).toBe(true)
    expect(shouldWarm(true, true, 1_000, 1_000 + WARM_EVERY_MS - 1)).toBe(false)
    expect(shouldWarm(true, true, 1_000, 1_000 + WARM_EVERY_MS)).toBe(true)
  })

  it('never where the host has no verified search, or with the page out of sight', () => {
    expect(shouldWarm(false, true, null, 1_000)).toBe(false)
    expect(shouldWarm(true, false, null, 1_000)).toBe(false)
  })

  it('asks again before the host lets a warmed browser go (8 minutes)', () => {
    expect(WARM_EVERY_MS).toBeLessThan(8 * 60_000)
  })
})
