import { describe, expect, it } from 'vitest'
import { senderFindings, type SenderInput } from './sender'
import { recipientFindings } from './recipients'
import type { Reputation } from '../sendingReputation'
import { levelOf } from '../../features/spam-score/types'

const sender = (over: Partial<SenderInput> = {}): SenderInput => ({
  fromEmail: 'jo@acme.test',
  managed: false,
  domainReady: true,
  dns: { spf: true, dmarc: true },
  dbl: { checked: true, listed: [] },
  freeMail: false,
  reputation: null,
  warmup: null,
  cold: false,
  ...over,
})

const rep = (status: Reputation['status'], codes: Reputation['reasons'][number]['code'][] = []): Reputation => ({
  status,
  score: status === 'poor' ? 40 : status === 'at_risk' ? 70 : 90,
  stats: {} as Reputation['stats'],
  reasons: codes.map((code) => ({ level: status === 'poor' ? 'poor' : 'at_risk', code, text: `${code} text`, fix: `${code} fix` })),
})

const codes = (input: SenderInput) => senderFindings(input).map((f) => f.code)

describe('the sender', () => {
  it('has nothing against a set-up domain with a good week', () => {
    expect(senderFindings(sender({ reputation: rep('good') }))).toEqual([])
  })

  it('needs SPF only where the copy sends itself, and DMARC everywhere', () => {
    expect(codes(sender({ dns: { spf: false, dmarc: false } }))).toEqual(['no_spf', 'no_dmarc'])
    expect(codes(sender({ managed: true, dns: { spf: false, dmarc: false } }))).toEqual(['no_dmarc'])
  })

  it('makes it high on its own for a blocklisted domain, free mail, an unready domain or poor reputation', () => {
    for (const input of [
      sender({ dbl: { checked: true, listed: ['acme.test'] } }),
      sender({ freeMail: true, fromEmail: 'jo@gmail.com' }),
      sender({ managed: true, domainReady: false }),
      sender({ reputation: rep('poor', ['bounces']) }),
    ]) {
      expect(senderFindings(input).some((f) => f.hard)).toBe(true)
    }
  })

  it('names a blocklisted link rather than the sender when it is the link', () => {
    const [f] = senderFindings(sender({ dbl: { checked: true, listed: ['bad.test'] } }))
    expect(f.text).toMatch(/links to bad\.test/)
  })

  it('adds Gmail-specific wording when Google opens are low', () => {
    const found = senderFindings(sender({ reputation: rep('at_risk', ['opens_google']) }))
    expect(found.map((f) => f.code)).toEqual(['reputation_at_risk', 'low_google_opens'])
    expect(found[1].text).toMatch(/^Gmail is probably putting it in spam/)
  })

  it('notes a new sender only for cold mail', () => {
    expect(codes(sender({ cold: true }))).toEqual(['new_sender'])
    expect(codes(sender({ cold: false }))).toEqual([])
  })

  it('follows warmup health', () => {
    const health = (state: string) => ({ state: 'warming' as const, health: { state, score: 50, reason: null, until: null } as any, problem: null })
    expect(codes(sender({ warmup: health('throttled') }))).toEqual(['warmup_throttled'])
    expect(senderFindings(sender({ warmup: health('blocked') }))[0].hard).toBe(true)
    expect(codes(sender({ warmup: health('healthy') }))).toEqual([])
  })

  it('is never something editing the email fixes', () => {
    expect(senderFindings(sender({ dns: { spf: false, dmarc: false }, cold: true })).every((f) => !f.fixable)).toBe(true)
  })
})

describe('the recipients', () => {
  const base = { total: 100, cold: 0, unconfirmed: 0, catchAll: 0, coldLimit: null }
  const codesOf = (over: Partial<typeof base> & { coldLimit?: { limit: number; left: number } | null }) => recipientFindings({ ...base, ...over }).map((f) => f.code)

  it('marks down cold, unverified and catch-all shares', () => {
    expect(codesOf({ cold: 49 })).toEqual([])
    expect(codesOf({ cold: 50 })).toEqual(['mostly_cold'])
    expect(codesOf({ unconfirmed: 10 })).toEqual(['some_unconfirmed'])
    expect(codesOf({ unconfirmed: 30 })).toEqual(['many_unconfirmed'])
    expect(codesOf({ catchAll: 30 })).toEqual(['many_catch_all'])
  })

  it("says how long today's limit spreads it, without points", () => {
    const [f] = recipientFindings({ ...base, cold: 100, coldLimit: { limit: 30, left: 10 } }).filter((x) => x.code === 'daily_limit')
    expect(f.points).toBe(0)
    expect(f.text).toMatch(/about 4 days/)
  })

  it('says nothing about an empty list', () => {
    expect(recipientFindings({ ...base, total: 0 })).toEqual([])
  })
})

describe('levels', () => {
  it('turn at 25 and 60', () => {
    expect([0, 24, 25, 59, 60, 100].map(levelOf)).toEqual(['low', 'low', 'medium', 'medium', 'high', 'high'])
  })
})
