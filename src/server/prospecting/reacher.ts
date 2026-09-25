// HTTP client for a self-hosted Reacher backend
// (reacherhq/check-if-email-exists, AGPL-3.0). Reacher runs as its own
// service; this app only talks to it over HTTP and never vendors its code.
//
//   POST {REACHER_URL}/v1/check_email
//   headers: x-reacher-secret (when RCH__HEADER_SECRET is set on the backend)
//   body:    { to_email, from_email?, hello_name?, proxy?: { host, port, username?, password? } }
//   returns: { is_reachable: 'safe'|'risky'|'invalid'|'unknown', mx, smtp, misc, syntax }

import type { CheckOutcome, ProxyConfig } from './proxyRouter'
import type { ReacherConfig } from './settings'

export type Reachability = 'safe' | 'risky' | 'invalid' | 'unknown'

export interface CheckResult {
  reachability: Reachability
  isCatchAll: boolean | null
  /** How the SMTP exchange went, for proxy health. */
  outcome: CheckOutcome
}

const TIMEOUT_MS = 60_000

/**
 * Reacher reports SMTP failures as `smtp: { type, message }` with
 * `is_reachable: 'unknown'`. The reply code in the message separates a
 * greylist (4xx, retry later) from a block (5xx policy rejection).
 */
export function classifySmtpOutcome(body: any): CheckOutcome {
  const smtp = body?.smtp
  const message = typeof smtp?.message === 'string' ? smtp.message : typeof smtp?.error === 'string' ? smtp.error : ''
  if (!message) return 'ok'
  if (/time[sd]?\s?out|timeout/i.test(message)) return 'timeout'
  if (/\b4\d\d\b|greylist|try again later|temporar/i.test(message)) return 'greylisted'
  if (/\b5\d\d\b.*(block|spam|blacklist|denied|reputation|policy)|(block|spamhaus|blacklist|denylist)/i.test(message)) return 'blocked'
  // Anything else is a failure we can't attribute to the proxy's IP.
  return 'ok'
}

export async function checkEmail(
  email: string,
  proxy: ProxyConfig | null,
  config: ReacherConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  const body: Record<string, unknown> = { to_email: email }
  if (config.fromEmail) body.from_email = config.fromEmail
  if (config.helloName) body.hello_name = config.helloName
  if (proxy) {
    body.proxy = {
      host: proxy.host,
      port: proxy.port,
      ...(proxy.username ? { username: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
    }
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.secret) headers['x-reacher-secret'] = config.secret

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${config.url}/v1/check_email`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Status only: the response can echo the address back.
      console.warn(`[Reacher] check_email ${res.status}`)
      return { reachability: 'unknown', isCatchAll: null, outcome: res.status >= 500 ? 'timeout' : 'ok' }
    }
    const json = await res.json()
    const reachability: Reachability = ['safe', 'risky', 'invalid', 'unknown'].includes(json?.is_reachable)
      ? json.is_reachable
      : 'unknown'
    const catchAll = json?.smtp?.is_catch_all
    return {
      reachability,
      isCatchAll: typeof catchAll === 'boolean' ? catchAll : null,
      outcome: classifySmtpOutcome(json),
    }
  } catch {
    console.warn('[Reacher] check_email request failed or timed out')
    return { reachability: 'unknown', isCatchAll: null, outcome: 'timeout' }
  } finally {
    clearTimeout(timer)
  }
}
