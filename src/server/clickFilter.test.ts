import { describe, expect, it } from 'vitest'
import { automatedClicks, automatedOpens, looksAutomated } from './clickFilter'

const sentAt = '2026-09-30T10:00:00.000Z'
const at = (seconds: number) => new Date(Date.parse(sentAt) + seconds * 1000).toISOString()

describe('looksAutomated', () => {
  it('knows scanners and scripts, and a missing user agent, from browsers', () => {
    for (const ua of ['', null, 'python-requests/2.31', 'Mozilla/5.0 (compatible; Barracuda Sentinel)', 'curl/8.4.0', 'Mozilla/5.0 HeadlessChrome/120.0'])
      expect(looksAutomated(ua)).toBe(true)
    for (const ua of ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'])
      expect(looksAutomated(ua)).toBe(false)
  })
})

describe('automatedClicks', () => {
  it('counts a click a while after sending as a person', () => {
    expect(automatedClicks([{ url: 'a', at: at(300) }], { sentAt })).toEqual([false])
  })

  it('marks clicks within 10 seconds of sending', () => {
    expect(automatedClicks([{ url: 'a', at: at(5) }, { url: 'a', at: at(20) }], { sentAt })).toEqual([true, false])
  })

  it('marks clicks on different links within 2 seconds of each other, but not the same link twice', () => {
    expect(automatedClicks([{ url: 'a', at: at(100) }, { url: 'b', at: at(101) }], { sentAt })).toEqual([true, true])
    expect(automatedClicks([{ url: 'a', at: at(100) }, { url: 'a', at: at(101) }], { sentAt })).toEqual([false, false])
    expect(automatedClicks([{ url: 'a', at: at(100) }, { url: 'b', at: at(110) }], { sentAt })).toEqual([false, false])
  })

  it('marks clicks within a minute of the trap link being followed', () => {
    const events = [{ url: 'a', at: at(100) }, { url: 'a', at: at(500) }]
    expect(automatedClicks(events, { sentAt, trappedAt: at(130) })).toEqual([true, false])
  })

  it('marks a click whose request said it was a scanner', () => {
    expect(automatedClicks([{ url: 'a', at: at(900), bot: true }], { sentAt })).toEqual([true])
  })
})

describe('automatedOpens', () => {
  it("marks loads as the email arrived, around the trap link, or by a script, but not a person's later on", () => {
    const events = [{ at: at(3) }, { at: at(95) }, { at: at(700), bot: true as const }, { at: at(1800) }]
    expect(automatedOpens(events, { sentAt, trappedAt: at(100) })).toEqual([true, true, true, false])
  })

  it("doesn't count Gmail's or Yahoo's image proxies as scanners", () => {
    expect(looksAutomated('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)')).toBe(false)
    expect(looksAutomated('YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html')).toBe(false)
  })
})
