import { beforeEach, describe, expect, it, vi } from 'vitest'

let report: any = null
let fromDomain: string | null = 'clean-sender.example'
let override: string | null = null
vi.mock('../db', () => ({ db: { getSenderHealth: () => report } }))
vi.mock('../notify', () => ({ notify: vi.fn() }))
vi.mock('./settings', () => ({
  getActiveVerifier: () => null,
  getProxyConfigs: () => ({ proxies: [] }),
  getReacherFromDomain: () => fromDomain,
  getListedDomainOverride: () => override,
}))

const { verificationPauseReason } = await import('./senderHealthMonitor')

const proxy = { host: '203.0.113.10', port: 1080, label: 'ovh-1' }
const ip = (issues: Array<{ level: string; code: string }>, listedOn: string[] = []) => ({
  label: 'ovh-1', host: '203.0.113.10', ip: '203.0.113.10', ptr: null, listedOn, unchecked: [], issues, level: 'ok',
})
const domain = (name: string, listedOn: string[]) => ({ domain: name, listedOn, unchecked: [], issues: [], level: listedOn.length ? 'critical' : 'ok' })

beforeEach(() => {
  report = null
  fromDomain = 'clean-sender.example'
  override = null
})

describe('verificationPauseReason', () => {
  it('carries on with no report, or a clean one', () => {
    expect(verificationPauseReason(proxy)).toBeNull()
    report = { ips: [ip([])], domain: domain('clean-sender.example', []) }
    expect(verificationPauseReason(proxy)).toBeNull()
  })

  it('pauses an IP on a spam blocklist, but not for Spamhaus\'s home/dynamic IP list', () => {
    report = { ips: [ip([{ level: 'critical', code: 'listed-barracuda' }], ['Barracuda'])], domain: null }
    expect(verificationPauseReason(proxy)).toMatch(/ovh-1 \(203\.0\.113\.10\) is on Barracuda/)
    report = { ips: [ip([{ level: 'critical', code: 'spamhaus-pbl' }], ['Spamhaus'])], domain: null }
    expect(verificationPauseReason(proxy)).toBeNull()
    // Only that IP: another proxy carries on.
    report = { ips: [ip([{ level: 'critical', code: 'spamhaus' }], ['Spamhaus'])], domain: null }
    expect(verificationPauseReason({ host: '203.0.113.5', port: 1080 })).toBeNull()
  })

  it('pauses everything while the FROM domain is listed, unless the user chose to keep testing with it', () => {
    fromDomain = 'listed-sender.example'
    report = { ips: [ip([])], domain: domain('listed-sender.example', ['Spamhaus DBL']) }
    expect(verificationPauseReason(proxy)).toMatch(/FROM domain listed-sender\.example is on Spamhaus DBL/)
    expect(verificationPauseReason(null)).toMatch(/FROM domain/)
    override = 'listed-sender.example'
    expect(verificationPauseReason(proxy)).toBeNull()
    // The override is for that domain only.
    override = 'other.bid'
    expect(verificationPauseReason(proxy)).toMatch(/FROM domain/)
  })

  it('ignores a listing for a domain no longer used as the sender (stale report)', () => {
    fromDomain = 'clean-sender.example'
    report = { ips: [ip([])], domain: domain('listed-sender.example', ['Spamhaus DBL']) }
    expect(verificationPauseReason(proxy)).toBeNull()
  })
})
