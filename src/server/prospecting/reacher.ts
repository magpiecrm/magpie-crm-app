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
const SENDER_DOMAIN_REJECTION = new RegExp(
  [
    'dbl\\.spamhaus',
    'spamhaus dbl',
    'domain block ?list',
    '[?&]c=r1102\\b',
    'sender (address|domain)[^.;]*?(reject|block|listed|blacklist|denylist|not allowed)',
    'mail ?from[^.;]*?(listed|blocked|blacklist|denylist)',
    'helo command rejected',
  ].join('|'),
  'i',
)

const CONNECTION_REFUSAL =
  /^permanent:.*(not allowed|not permitted|access denied|no smtp service|connection (refused|rejected|denied)|go away|client host rejected)/i

export function classifySmtpOutcome(body: any): CheckOutcome {
  const smtp = body?.smtp
  const err = smtp?.error
  const rawMessage = err?.message ?? smtp?.message ?? (typeof err === 'string' ? err : '')
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage ?? '')
  // The proxy answered but couldn't connect onward (SOCKS5 replies 3-6, e.g.
  // "Error with reply: TTL expired."): the company's mail server refuses
  // connections from it, or is down. Not the proxy's fault.
  if (/reply:\s*(TTL expired|host unreachable|network unreachable|connection refused)/i.test(message)) return 'unreachable'
  // Refused because of our sender identity (the FROM or HELO domain), not the
  // IP: e.g. the domain is on Spamhaus's DBL. IONOS says so only through its
  // case code (r1102: "MailFrom domain listed on a Spamhaus blocklist").
  if (SENDER_DOMAIN_REJECTION.test(message)) return 'sender_rejected'
  // The proxy itself failed (bad credentials, refused, unreachable): count it
  // against the proxy so a misconfigured one gets benched.
  if (err?.type === 'Socks5' || /socks|proxy|authentication rejected/i.test(message)) return 'blocked'
  if (!message) return 'ok'
  if (/time[sd]?\s?out|timeout/i.test(message)) return 'timeout'
  if (/\b4\d\d\b|greylist|try again later|temporar/i.test(message)) return 'greylisted'
  if (/\b5\d\d\b.*(block|spam|blacklist|denied|reputation|policy)|(block|spamhaus|blacklist|denylist)/i.test(message)) return 'blocked'
  // IONOS (1&1) words every IP policy rejection this way, without a reply code
  // (its sender-domain case, r1102, is caught above).
  if (/reject due to policy restrictions/i.test(message)) return 'blocked'
  // A flat refusal that says nothing about the address, e.g. "550 5.5.0 Not
  // allowed." in place of the greeting: the server turns away this IP (often
  // any hosting IP), so another IP may get through.
  if (CONNECTION_REFUSAL.test(message) && !/user|mailbox|recipient|address|rcpt/i.test(message)) return 'unreachable'
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
    const outcome = classifySmtpOutcome(json)
    return {
      reachability,
      isCatchAll: typeof catchAll === 'boolean' ? catchAll : null,
      outcome,
      detail:
        outcome === 'unreachable'
          ? "it doesn't accept connections from the verification server"
          : outcome === 'sender_rejected'
            ? 'it refuses checks from your verification domain, which is likely on a blocklist. See Settings → Prospecting'
            : rawError
            ? (typeof rawError === 'string' ? rawError : JSON.stringify(rawError)).slice(0, 300)
            : undefined,
    }
  } catch {
    console.warn('[Reacher] check_email request failed or timed out')
    return { reachability: 'unknown', isCatchAll: null, outcome: 'timeout', detail: 'Could not reach Reacher (is it running?)' }
  } finally {
    clearTimeout(timer)
  }
}
