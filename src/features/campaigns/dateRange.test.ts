import { describe, expect, it } from 'vitest'
import { ALL_TIME, inDateRange } from './dateRange'

describe('inDateRange', () => {
  it('shows every campaign by default, whatever the year', () => {
    for (const sentDate of ['2025-03-01T10:00:00Z', '2026-06-15T10:00:00Z', '2027-01-01T00:30:00Z', '2031-12-31T23:00:00Z']) {
      expect(inDateRange({ sentDate }, ALL_TIME)).toBe(true)
    }
  })

  it('keeps whole days at both ends, in local time', () => {
    const range = { start: '2027-01-01', end: '2027-01-31' }
    expect(inDateRange({ sentDate: new Date(2027, 0, 1, 0, 0, 0).toISOString() }, range)).toBe(true)
    expect(inDateRange({ sentDate: new Date(2027, 0, 31, 23, 59, 59).toISOString() }, range)).toBe(true)
    expect(inDateRange({ sentDate: new Date(2026, 11, 31, 23, 59, 59).toISOString() }, range)).toBe(false)
    expect(inDateRange({ sentDate: new Date(2027, 1, 1, 0, 0, 0).toISOString() }, range)).toBe(false)
  })

  it('takes one side alone as open on the other', () => {
    const sentDate = new Date(2030, 5, 1).toISOString()
    expect(inDateRange({ sentDate }, { start: '2027-01-01', end: '' })).toBe(true)
    expect(inDateRange({ sentDate }, { start: '', end: '2027-01-01' })).toBe(false)
  })

  it('goes by when a campaign was made until it is sent, and always shows one with no date', () => {
    const range = { start: '2027-01-01', end: '2027-12-31' }
    expect(inDateRange({ sentDate: null, createdAt: new Date(2027, 4, 1).toISOString() }, range)).toBe(true)
    expect(inDateRange({ sentDate: null, createdAt: new Date(2026, 4, 1).toISOString() }, range)).toBe(false)
    expect(inDateRange({}, range)).toBe(true)
  })
})
