import { describe, expect, it } from 'vitest'
import { everyText } from './batches'
import { sentMessage } from './sendResult'

describe('sentMessage', () => {
  it('says what a first batch reached and how the rest follow', () => {
    expect(sentMessage({ sentCount: 100, later: 400, batches: { size: 100, everyMinutes: 60 } })).toBe(
      'First batch sent to 100 recipients. The other 400 follow by themselves, 100 every hour.',
    )
    // The last batch, or a campaign that fitted in one: nothing follows.
    expect(sentMessage({ sentCount: 40 })).toBe('Campaign sent to 40 recipients.')
    // Left for tomorrow by the daily limit, not by batches.
    expect(sentMessage({ sentCount: 30, later: 70 })).toContain('follow automatically from tomorrow')
  })

  it('names the wait between batches', () => {
    expect([15, 60, 120, 1440, 2880].map(everyText)).toEqual(['every 15 minutes', 'every hour', 'every 2 hours', 'every day', 'every 2 days'])
  })
})
