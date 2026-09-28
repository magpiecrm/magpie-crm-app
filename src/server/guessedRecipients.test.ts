import { describe, expect, it } from 'vitest'
import { firstBatchPassed, newHold, splitGuesses } from './guessedRecipients'

type Row = { id: number; source?: string; email_status?: 'verified' | 'catch_all_likely' }
const guess = (i: number): Row => ({ id: i, source: 'socialfetch', email_status: 'catch_all_likely' })
const own = (i: number): Row => ({ id: i })

describe('splitGuesses', () => {
  it("holds back unconfirmed addresses past the first 50, never the user's own or verified ones", () => {
    const contacts: Row[] = [own(-1), { id: -2, source: 'socialfetch', email_status: 'verified' }, ...Array.from({ length: 70 }, (_, i) => guess(i))]
    const { send, held, firstBatch, startHold } = splitGuesses(contacts, null, false)
    expect(send).toHaveLength(52)
    expect(held.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 50))
    expect({ firstBatch, startHold }).toEqual({ firstBatch: 50, startHold: true })
  })

  it('counts a prospected contact with no recorded status as unconfirmed', () => {
    const contacts: Row[] = Array.from({ length: 51 }, (_, i) => ({ id: i, source: 'socialfetch' }))
    expect(splitGuesses(contacts, null, false).held).toHaveLength(1)
  })
})

describe('firstBatchPassed', () => {
  const hold = { status: 'waiting' as const, first_batch: 50, held: 20, release_at: '' }
  it('lets one bounce in 50 through, not two', () => {
    expect(firstBatchPassed(hold, 0)).toBe(true)
    expect(firstBatchPassed(hold, 1)).toBe(true)
    expect(firstBatchPassed(hold, 2)).toBe(false)
  })
})

describe('host rules', () => {
  it('set the batch size, the wait and the bounce rate a hold is judged by', () => {
    const contacts = Array.from({ length: 30 }, (_, i) => guess(i))
    expect(splitGuesses(contacts, null, false, 25).held).toHaveLength(5)
    const now = Date.parse('2026-09-28T12:00:00Z')
    const hold = newHold(25, 5, { formatConfirmed: 0.85, firstBatch: 25, holdHours: 4, maxBounceRate: 0.05 }, now)
    expect(hold).toEqual({ status: 'waiting', first_batch: 25, held: 5, release_at: '2026-09-28T16:00:00.000Z', max_bounce_rate: 0.05 })
    expect(firstBatchPassed(hold, 1)).toBe(true)
    expect(firstBatchPassed(hold, 2)).toBe(false)
  })
})
