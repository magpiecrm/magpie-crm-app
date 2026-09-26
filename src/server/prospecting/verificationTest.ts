// "Test verification" in Settings → Prospecting: does Reacher work, directly
// or through each configured proxy?
//
// Each route is checked against Gmail and Microsoft 365 (the strictest common
// provider) using a random address that can't exist, so no real mailbox is
// ever probed. A definite answer (invalid) means the check worked.

import crypto from 'crypto'
import { checkEmail, type CheckResult } from './reacher'
import { getActiveVerifier, getProxyConfigs } from './settings'

const PROBES = [
  { provider: 'Gmail', domain: 'gmail.com' },
  { provider: 'Microsoft 365', domain: 'microsoft.com' },
]
const MAX_ROUTES = 5

export interface VerificationTestResult {
  configured: boolean
  provider: 'reacher' | null
  results: Array<{ via: string; provider: string; ok: boolean; ms: number; detail?: string }>
}

export async function testVerification(): Promise<VerificationTestResult> {
  const active = getActiveVerifier()
  if (!active) return { configured: false, provider: null, results: [] }

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
              : r.outcome === 'timeout' || r.outcome === 'unreachable'
                ? 'Couldn’t connect to the mail server; outbound port 25 may be blocked on this route.'
                : 'No definite answer from the mail server.'),
      }
    }),
  )
}
