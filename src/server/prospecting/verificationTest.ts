// "Test verification" in Settings → Prospecting: does the active verifier
// work? For Reacher, directly or through each configured proxy; for
// NeverBounce, through its API (2 credits per run).
//
// Each route is checked against Gmail and Microsoft 365 (the strictest common
// provider) using a random address that can't exist, so no real mailbox is
// ever probed. A definite answer (invalid) means the check worked.

import crypto from 'crypto'
import { checkEmailNeverBounce, getNeverBounceCredits } from './neverbounce'
import { checkEmail, type CheckResult } from './reacher'
import { getActiveVerifier, getProxyConfigs } from './settings'

const PROBES = [
  { provider: 'Gmail', domain: 'gmail.com' },
  { provider: 'Microsoft 365', domain: 'microsoft.com' },
]
const MAX_ROUTES = 5

export interface VerificationTestResult {
  configured: boolean
  provider: 'reacher' | 'neverbounce' | null
  results: Array<{ via: string; provider: string; ok: boolean; ms: number; detail?: string }>
  /** NeverBounce credits left after the test. */
  credits?: number | null
}

export async function testVerification(): Promise<VerificationTestResult> {
  const active = getActiveVerifier()
  if (!active) return { configured: false, provider: null, results: [] }

  if (active.provider === 'neverbounce') {
    const results = await runProbes('NeverBounce', (address) => checkEmailNeverBounce(address, active.apiKey))
    let credits: number | null = null
    try {
      credits = await getNeverBounceCredits(active.apiKey)
    } catch {
      // The checks above already report any key problem.
    }
    return { configured: true, provider: 'neverbounce', results, credits }
  }

  const { proxies } = getProxyConfigs()
  const routes = proxies.length ? proxies.slice(0, MAX_ROUTES) : [null]
  const results: VerificationTestResult['results'] = []
  for (const route of routes) {
    const via = route ? route.label || `${route.host}:${route.port}` : 'Direct (no proxy)'
    results.push(...(await runProbes(via, (address) => checkEmail(address, route, active.reacher))))
  }
  return { configured: true, provider: 'reacher', results }
}

async function runProbes(via: string, check: (address: string) => Promise<CheckResult>): Promise<VerificationTestResult['results']> {
  return Promise.all(
    PROBES.map(async ({ provider, domain }) => {
      const address = `zz-probe-${crypto.randomBytes(6).toString('hex')}@${domain}`
      const started = Date.now()
      const r = await check(address)
      // Any definite answer (including "catch-all") means the check worked.
      const ok = r.reachability === 'invalid' || r.reachability === 'safe' || r.reachability === 'risky' || r.isCatchAll === true
      return {
        via,
        provider,
        ok,
        ms: Date.now() - started,
        detail: ok
          ? undefined
          : r.detail ??
            (r.outcome === 'blocked'
              ? 'The mail server refused this IP (likely a blocklist).'
              : r.outcome === 'timeout'
                ? 'Timed out; outbound port 25 may be blocked.'
                : 'No definite answer from the mail server.'),
      }
    }),
  )
}
