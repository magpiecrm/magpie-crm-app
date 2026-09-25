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

export type ReacherCheckConfig = ReacherConfig

export type Reachability = 'safe' | 'risky' | 'invalid' | 'unknown'

export interface CheckResult {
  reachability: Reachability
  isCatchAll: boolean | null
  /** How the SMTP exchange went, for proxy health. */
  outcome: CheckOutcome
  /** Reacher's SMTP error message, if any. Server replies only, no address. */
  detail?: string
}

const TIMEOUT_MS = 60_000

/**
 * Reacher reports SMTP failures as `smtp: { type, message }` with
 * `is_reachable: 'unknown'`. The reply code in the message separates a
 * greylist (4xx, retry later) from a block (5xx policy rejection).
 */
export function classifySmtpOutcome(body: any): CheckOutcome {
  const smtp = body?.smtp
  const err = smtp?.error
  const rawMessage = err?.message ?? smtp?.message ?? (typeof err === 'string' ? err : '')
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage ?? '')
  // The proxy itself failed (bad credentials, refused, unreachable): count it
  // against the proxy so a misconfigured one gets benched.
  if (err?.type === 'Socks5' || /socks|proxy|authentication rejected/i.test(message)) return 'blocked'
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
  // Plain SMTP for every provider: the headless-browser methods Reacher uses
  // for consumer Outlook/Yahoo by default need a WebDriver we don't run, and
  // prospecting targets company domains anyway.
  const body: Record<string, unknown> = {
    to_email: email,
    hotmailb2c_verif_method: 'Smtp',
    yahoo_verif_method: 'Smtp',
  }
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
      return {
        reachability: 'unknown',
        isCatchAll: null,
        outcome: res.status >= 500 ? 'timeout' : 'ok',
        detail: res.status === 400 || res.status === 401 ? 'Reacher refused the request; check the Reacher secret.' : `Reacher returned HTTP ${res.status}`,
      }
    }
    const json = await res.json()
    const reachability: Reachability = ['safe', 'risky', 'invalid', 'unknown'].includes(json?.is_reachable)
      ? json.is_reachable
      : 'unknown'
    const catchAll = json?.smtp?.is_catch_all
    const rawError = json?.smtp?.error?.message ?? json?.smtp?.message
    return {
      reachability,
      isCatchAll: typeof catchAll === 'boolean' ? catchAll : null,
      outcome: classifySmtpOutcome(json),
      detail: rawError ? (typeof rawError === 'string' ? rawError : JSON.stringify(rawError)).slice(0, 300) : undefined,
    }
  } catch {
    console.warn('[Reacher] check_email request failed or timed out')
    return { reachability: 'unknown', isCatchAll: null, outcome: 'timeout', detail: 'Could not reach Reacher (is it running?)' }
  } finally {
    clearTimeout(timer)
  }
}
