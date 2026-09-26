// Routes SMTP verification checks through a pool of SOCKS5 proxies.
//
// In-memory by design: this app is a single process, and proxy health is a
// short-lived signal that should reset on restart anyway. Each check acquires
// a lease, runs, and reports how it went; proxies that start getting blocked or
// timing out are benched for a while so one bad IP doesn't sink a whole save.

export interface ProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
  label?: string
}

/** Mail provider behind a domain's MX, which sets how hard we may probe it. */
export type MailProvider = 'google' | 'microsoft' | 'other'

/**
 * `unreachable`: the proxy couldn't connect to that company's mail server at
 * all (it drops connections from hosting IPs, or is down). That's the
 * destination's doing, not a sign this proxy's IP is burned.
 */
export type CheckOutcome = 'ok' | 'greylisted' | 'blocked' | 'timeout' | 'unreachable'

export interface ProxyHealth {
  label: string
  ok: number
  greylisted: number
  blocked: number
  timeouts: number
  unreachable: number
  successRate: number | null
  benchedUntil: string | null
}

export interface RouterOptions {
  /** Checks per proxy per minute. */
  perProxyPerMinute: number
  /** Checks per provider per minute, across all proxies. Google/Microsoft throttle hardest. */
  perProviderPerMinute: Record<MailProvider, number>
  /** Consecutive blocks/timeouts before a proxy is benched. */
  benchAfter: number
  /**
   * Consecutive "couldn't connect" results before a proxy is benched. Higher
   * than `benchAfter`: one company refusing connections gives at most two in
   * a row (the finder stops after two unknowns), so only several companies in
   * a row point at the proxy itself, e.g. its host blocking port 25.
   */
  benchAfterUnreachable: number
  benchMs: number
  /** How long `acquire` waits for a free slot before giving up. */
  maxWaitMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const DEFAULTS: RouterOptions = {
  perProxyPerMinute: 20,
  perProviderPerMinute: { google: 10, microsoft: 6, other: 60 },
  benchAfter: 3,
  benchAfterUnreachable: 6,
  benchMs: 15 * 60_000,
  maxWaitMs: 60_000,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

interface ProxyState {
  config: ProxyConfig
  label: string
  recent: number[]
  ok: number
  greylisted: number
  blocked: number
  timeouts: number
  unreachable: number
  consecutiveFailures: number
  consecutiveUnreachable: number
  benchedUntil: number
}

export interface Lease {
  /** Null means "connect directly" — no proxies configured. */
  proxy: ProxyConfig | null
  report(outcome: CheckOutcome): void
}

export class ProxyRouter {
  private readonly opts: RouterOptions
  private readonly proxies: ProxyState[]
  private readonly providerRecent: Record<MailProvider, number[]> = { google: [], microsoft: [], other: [] }
  private cursor = 0

  constructor(proxies: ProxyConfig[], opts: Partial<RouterOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts, perProviderPerMinute: { ...DEFAULTS.perProviderPerMinute, ...opts.perProviderPerMinute } }
    this.proxies = proxies.map((config, i) => ({
      config,
      label: config.label || `proxy-${i + 1}`,
      recent: [],
      ok: 0,
      greylisted: 0,
      blocked: 0,
      timeouts: 0,
      unreachable: 0,
      consecutiveFailures: 0,
      consecutiveUnreachable: 0,
      benchedUntil: 0,
    }))
  }

  get size() {
    return this.proxies.length
  }

  /**
   * Waits for a proxy with capacity for this provider, round-robin. Throws when
   * every proxy is benched or nothing frees up within `maxWaitMs`.
   */
  async acquire(provider: MailProvider): Promise<Lease> {
    const deadline = this.opts.now() + this.opts.maxWaitMs
    for (;;) {
      const now = this.opts.now()
      this.prune(now)
      const providerOk = this.providerRecent[provider].length < this.opts.perProviderPerMinute[provider]

      if (this.proxies.length === 0) {
        if (providerOk) return this.lease(null, provider, now)
      } else {
        const available = this.proxies.filter((p) => p.benchedUntil <= now)
        if (available.length === 0) {
          throw new Error('All verification proxies are temporarily benched after repeated blocks. Try again later.')
        }
        if (providerOk) {
          for (let i = 0; i < this.proxies.length; i++) {
            const p = this.proxies[(this.cursor + i) % this.proxies.length]
            if (p.benchedUntil > now || p.recent.length >= this.opts.perProxyPerMinute) continue
            this.cursor = (this.cursor + i + 1) % this.proxies.length
            return this.lease(p, provider, now)
          }
        }
      }

      if (now >= deadline) throw new Error('Verification rate limit reached. Try again in a minute.')
      await this.opts.sleep(Math.min(1_000, Math.max(50, deadline - now)))
    }
  }

  private lease(p: ProxyState | null, provider: MailProvider, now: number): Lease {
    this.providerRecent[provider].push(now)
    p?.recent.push(now)
    let reported = false
    return {
      proxy: p?.config ?? null,
      report: (outcome) => {
        if (reported || !p) return
        reported = true
        this.record(p, outcome)
      },
    }
  }

  private record(p: ProxyState, outcome: CheckOutcome) {
    if (outcome === 'ok') {
      p.ok++
      p.consecutiveFailures = 0
      p.consecutiveUnreachable = 0
      return
    }
    if (outcome === 'unreachable') {
      p.unreachable++
      if (++p.consecutiveUnreachable >= this.opts.benchAfterUnreachable) this.bench(p)
      return
    }
    if (outcome === 'greylisted') {
      // Greylisting is the receiving server's normal "come back later", not a
      // sign the IP is burned, so it doesn't count toward benching.
      p.greylisted++
      return
    }
    if (outcome === 'blocked') p.blocked++
    else p.timeouts++
    p.consecutiveFailures++
    if (p.consecutiveFailures >= this.opts.benchAfter) this.bench(p)
  }

  private bench(p: ProxyState) {
    p.benchedUntil = this.opts.now() + this.opts.benchMs
    p.consecutiveFailures = 0
    p.consecutiveUnreachable = 0
    console.warn(`[ProxyRouter] Benched ${p.label} for ${Math.round(this.opts.benchMs / 60_000)} min`)
  }

  private prune(now: number) {
    const cutoff = now - 60_000
    for (const p of this.proxies) p.recent = p.recent.filter((t) => t > cutoff)
    for (const k of Object.keys(this.providerRecent) as MailProvider[]) {
      this.providerRecent[k] = this.providerRecent[k].filter((t) => t > cutoff)
    }
  }

  health(): ProxyHealth[] {
    const now = this.opts.now()
    return this.proxies.map((p) => {
      const total = p.ok + p.blocked + p.timeouts
      return {
        label: p.label,
        ok: p.ok,
        greylisted: p.greylisted,
        blocked: p.blocked,
        timeouts: p.timeouts,
        unreachable: p.unreachable,
        successRate: total > 0 ? p.ok / total : null,
        benchedUntil: p.benchedUntil > now ? new Date(p.benchedUntil).toISOString() : null,
      }
    })
  }
}

/** Parses REACHER_PROXIES. Invalid entries are dropped with a warning, not fatal. */
export function parseProxyConfig(raw: string | undefined): ProxyConfig[] {
  if (!raw?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[ProxyRouter] REACHER_PROXIES is not valid JSON; verifying without proxies')
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((p: any, i) => {
    const port = Number(p?.port)
    if (typeof p?.host !== 'string' || !p.host || !Number.isInteger(port) || port <= 0) {
      console.warn(`[ProxyRouter] Ignoring REACHER_PROXIES[${i}]: needs host and port`)
      return []
    }
    return [{
      host: p.host,
      port,
      username: typeof p.username === 'string' ? p.username : undefined,
      password: typeof p.password === 'string' ? p.password : undefined,
      label: typeof p.label === 'string' ? p.label : undefined,
    }]
  })
}

export function providerFromMx(mxHosts: string[]): MailProvider {
  const hosts = mxHosts.map((h) => h.toLowerCase())
  if (hosts.some((h) => /(google\.com|googlemail\.com)\.?$/.test(h))) return 'google'
  if (hosts.some((h) => /(outlook\.com|protection\.outlook\.com|hotmail\.com)\.?$/.test(h))) return 'microsoft'
  return 'other'
}
