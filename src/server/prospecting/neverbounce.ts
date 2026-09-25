// NeverBounce single-address verification (https://developers.neverbounce.com),
// the hosted alternative to self-hosted Reacher: checks run from NeverBounce's
// IPs, so this app never talks to a mail server itself.
//
//   GET https://api.neverbounce.com/v4.2/single/check?key=…&email=…&timeout=…
//     -> { status: 'success', result: 'valid'|'invalid'|'disposable'|'catchall'|'unknown', … }
//   GET https://api.neverbounce.com/v4.2/account/info?key=…
//     -> { status: 'success', credits_info: { paid_credits_remaining, free_credits_remaining, … } }
//
// Failures come back as { status: 'auth_failure'|'throttle_triggered'|
// 'bad_referrer'|'general_failure', message } (per the official Node SDK).
// Each check costs one NeverBounce credit.
//
// The key and the address both travel in the query string, so URLs are never
// logged.

import type { CheckResult } from './reacher'

const BASE = 'https://api.neverbounce.com/v4.2'
const TIMEOUT_S = 30

type Fetch = typeof fetch

function errorDetail(status: unknown, message: unknown): string {
  if (status === 'auth_failure') return 'NeverBounce rejected the API key. Check it in Settings → Prospecting.'
  if (status === 'throttle_triggered') return 'NeverBounce is rate limiting requests; try again shortly.'
  const text = typeof message === 'string' && message.trim() ? message.trim() : String(status ?? 'unknown error')
  return `NeverBounce: ${text.slice(0, 200)}`
}

async function get(path: string, params: Record<string, string>, fetchImpl: Fetch): Promise<{ http: number; body: any }> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), (TIMEOUT_S + 15) * 1000)
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    const body = await res.json().catch(() => null)
    return { http: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkEmailNeverBounce(email: string, apiKey: string, fetchImpl: Fetch = fetch): Promise<CheckResult> {
  let http: number
  let body: any
  try {
    ;({ http, body } = await get('/single/check', { key: apiKey, email, timeout: String(TIMEOUT_S) }, fetchImpl))
  } catch {
    console.warn('[NeverBounce] single/check request failed or timed out')
    return { reachability: 'unknown', isCatchAll: null, outcome: 'ok', detail: 'Could not reach NeverBounce.' }
  }

  if (http >= 400 || !body) {
    console.warn(`[NeverBounce] single/check HTTP ${http}`)
    return { reachability: 'unknown', isCatchAll: null, outcome: 'ok', detail: `NeverBounce returned HTTP ${http}.` }
  }
  if (body.status !== 'success') {
    console.warn(`[NeverBounce] single/check ${body.status}`)
    return { reachability: 'unknown', isCatchAll: null, outcome: 'ok', detail: errorDetail(body.status, body.message) }
  }

  switch (body.result) {
    case 'valid':
      return { reachability: 'safe', isCatchAll: false, outcome: 'ok' }
    // A throwaway inbox isn't a work address worth keeping.
    case 'invalid':
    case 'disposable':
      return { reachability: 'invalid', isCatchAll: false, outcome: 'ok' }
    // Accept-all domain: nothing there can be verified, stop guessing.
    case 'catchall':
      return { reachability: 'unknown', isCatchAll: true, outcome: 'ok' }
    default:
      return { reachability: 'unknown', isCatchAll: null, outcome: 'ok', detail: 'NeverBounce could not reach the mail server.' }
  }
}

/** Remaining credits (paid + free). Free call; throws NeverBounce's own error. */
export async function getNeverBounceCredits(apiKey: string, fetchImpl: Fetch = fetch): Promise<number> {
  const { http, body } = await get('/account/info', { key: apiKey }, fetchImpl)
  if (http >= 400 || !body) throw new Error(`NeverBounce returned HTTP ${http}.`)
  if (body.status !== 'success') throw new Error(errorDetail(body.status, body.message))
  const info = body.credits_info ?? {}
  return (Number(info.paid_credits_remaining) || 0) + (Number(info.free_credits_remaining) || 0)
}
