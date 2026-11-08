import { describe, expect, it } from 'vitest'
import { daysFromNow, dueBucket, dueLabel, dueParts, dueShort, fromLocalInput, lateBy } from './tasks'

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

  it('reads short in the Tasks page column, the heading saying whether it is overdue', () => {
    expect(dueShort(at(30, 17), now)).toBe('Today 17:00')
    expect(dueShort(at(31, 9), now)).toBe('Tomorrow 09:00')
    expect(dueShort(at(29, 16, 12), now)).toBe('Yesterday 16:12')
    expect(dueShort(at(26, 9), now)).toMatch(/^Sat 26 Sept?$/)
    expect(dueShort(at(45, 9), now)).toBe('Thu 15 Oct')
    expect(dueShort(new Date(2027, 0, 4, 9).toISOString(), now)).toBe('Mon 4 Jan 2027')
  })

  it('gives the day and the time apart, for a column that lines the times up', () => {
    expect(dueParts(at(30, 17), now)).toEqual({ day: 'Today', time: '17:00', relative: true })
    expect(dueParts(at(45, 9, 30), now)).toEqual({ day: 'Thu 15 Oct', time: '09:30', relative: false })
  })

  it('says how late an overdue task is', () => {
    expect(lateBy(at(30, 13, 35), now)).toBe('25m late')
    expect(lateBy(at(30, 9), now)).toBe('5h late')
    expect(lateBy(at(29, 13), now)).toBe('1 day late')
    expect(lateBy(at(26, 10), now)).toBe('4 days late')
  })

  it('reads a date-and-time field', () => {
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('2026-10-02T09:00')).toBe(new Date(2026, 9, 2, 9, 0).toISOString())
  })
})
