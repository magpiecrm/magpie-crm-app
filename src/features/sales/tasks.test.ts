import { describe, expect, it } from 'vitest'
import { daysFromNow, dueBucket, dueLabel, fromLocalInput } from './tasks'

// Local times throughout, so these hold in any time zone.
const now = new Date(2026, 8, 30, 14, 0)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString()

describe('task due times', () => {
  it('sets a follow-up for 9am on the day', () => {
    expect(daysFromNow(3, now)).toBe(at(33, 9))
  })

  it('sorts a due time into overdue, today or upcoming', () => {
    expect(dueBucket(null, now)).toBe('none')
    expect(dueBucket(at(30, 9), now)).toBe('overdue')
    expect(dueBucket(at(30, 17), now)).toBe('today')
    expect(dueBucket(at(31, 9), now)).toBe('upcoming')
  })

  it('reads as today, tomorrow or a date, marking overdue ones', () => {
    expect(dueLabel(at(30, 17), now)).toBe('Today 17:00')
    expect(dueLabel(at(30, 9), now)).toBe('Overdue · Today 09:00')
    expect(dueLabel(at(31, 9), now)).toBe('Tomorrow 09:00')
    expect(dueLabel(at(28, 9), now)).toMatch(/^Overdue · Mon 28 Sept?$/)
    expect(dueLabel(null, now)).toBe('No due date')
  })

  it('reads a date-and-time field', () => {
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('2026-10-02T09:00')).toBe(new Date(2026, 9, 2, 9, 0).toISOString())
  })
})
