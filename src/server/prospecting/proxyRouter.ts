// Routes SMTP verification checks through a pool of SOCKS5 proxies (or
// directly, when there are none), keeping every IP's checks gentle enough that
// mail servers don't mistake them for address harvesting.
//
// Limits, all per verifying IP so adding a proxy adds capacity:
//   - checks per minute, overall and per mail provider (Google/Microsoft
//     throttle hardest);
//   - checks per day (adjustable in Settings).
// And per company (mail domain), across all IPs:
//   - paced: a short burst (one person's guesses), then about 2 a minute;
//   - rejected guesses per day: many rejections is what harvesting looks
//     like, so after the cap that company waits until tomorrow. Checks that
//     hit real mailboxes (a known format) don't count.
// Pausing: an IP that's blocklisted (see senderHealth.ts) or whose recent
// checks are mostly blocked stops being used until it's clean again.
//
// In-memory by design: this app is a single process, and these are
// short-lived signals; a restart resets them.

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
  /** Why it's not being used right now (blocklisted, high block rate), if it isn't. */
  paused: string | null
  checksToday: number
  dailyCap: number
}

export interface RouterOptions {
  /** Checks per IP per minute. */
  perProxyPerMinute: number
  /** Checks per IP per minute to each mail provider. Google/Microsoft throttle hardest. */
  perProviderPerMinute: Record<MailProvider, number>
  /** Checks to one company within `domainWindowMs`, across all IPs: a burst, then paced. */
  perDomainBurst: number
  domainWindowMs: number
  /** Rejected guesses at one company per day before its checks wait until tomorrow. */
  rejectionsPerDomainPerDay: number
  /** Checks per IP per day. A function, so a change in Settings applies at once. */
  dailyCapPerIp: () => number
  /** Consecutive blocks/timeouts before an IP is benched. */
  benchAfter: number
  /**
   * Consecutive "couldn't connect" results before an IP is benched. Higher
   * than `benchAfter`: one company refusing connections gives at most two in
   * a row (the finder stops after two unknowns), so only several companies in
   * a row point at the IP itself, e.g. its host blocking port 25.
   */
  benchAfterUnreachable: number
  benchMs: number
  /** Share of blocked results among an IP's last `blockRateWindow` checks that pauses it. */
  blockRatePause: number
  blockRateWindow: number
  /** Fewest checks before a block rate counts, so two bad answers don't pause an IP. */
  blockRateMinChecks: number
  blockRatePauseMs: number
  /** Why an IP (null: this server's own) must not be used right now, e.g. it's blocklisted. */
  pausedReason: (proxy: ProxyConfig | null) => string | null
  /** Told when an IP is paused for a high block rate. */
  onPause: (label: string, reason: string) => void
  /** How long `acquire` waits for a free slot before giving up. */
  maxWaitMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const DEFAULTS: RouterOptions = {
  perProxyPerMinute: 20,
  perProviderPerMinute: { google: 10, microsoft: 6, other: 20 },
  perDomainBurst: 6,
  domainWindowMs: 3 * MINUTE,
  rejectionsPerDomainPerDay: 20,
  dailyCapPerIp: () => 1_500,
  benchAfter: 3,
  benchAfterUnreachable: 6,
  benchMs: 15 * MINUTE,
  blockRatePause: 0.3,
  blockRateWindow: 50,
  blockRateMinChecks: 20,
  blockRatePauseMs: 60 * MINUTE,
  pausedReason: () => null,
  onPause: () => {},
  maxWaitMs: 60_000,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/** A limit that won't clear by waiting a minute: the caller should say so, not retry. */
export class VerificationLimitError extends Error {
  constructor(message: string, readonly code: 'paused' | 'daily_cap' | 'domain_rejections' | 'benched' | 'busy') {
    super(message)
    this.name = 'VerificationLimitError'
  }
}

interface ProxyState {
  config: ProxyConfig | null
  label: string
  recent: number[]
  providerRecent: Record<MailProvider, number[]>
  today: number[]
  ok: number
  greylisted: number
  blocked: number
  timeouts: number
  unreachable: number
  consecutiveFailures: number
  consecutiveUnreachable: number
  /** Last few results, true when blocked, for the block-rate pause. */
  lastResults: boolean[]
  benchedUntil: number
}

interface DomainState {
  recent: number[]
  rejections: number[]
}

export interface Lease {
  /** Null means "connect directly" — no proxies configured. */
  proxy: ProxyConfig | null
  /** `rejected`: the mail server said this address doesn't exist. */
  report(outcome: CheckOutcome, rejected?: boolean): void
}

const newState = (config: ProxyConfig | null, label: string): ProxyState => ({
  config,
  label,
  recent: [],
  providerRecent: { google: [], microsoft: [], other: [] },
  today: [],
  ok: 0,
  greylisted: 0,
  blocked: 0,
  timeouts: 0,
  unreachable: 0,
  consecutiveFailures: 0,
  consecutiveUnreachable: 0,
  lastResults: [],
  benchedUntil: 0,
})

export class ProxyRouter {
  private readonly opts: RouterOptions
  private readonly proxies: ProxyState[]
  /** This server's own IP, used when no proxies are configured. */
  private readonly direct = newState(null, 'this server')
  private readonly domains = new Map<string, DomainState>()
  private cursor = 0

  constructor(proxies: ProxyConfig[], opts: Partial<RouterOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts, perProviderPerMinute: { ...DEFAULTS.perProviderPerMinute, ...opts.perProviderPerMinute } }
    this.proxies = proxies.map((config, i) => newState(config, config.label || `proxy-${i + 1}`))
  }

  get size() {
    return this.proxies.length
  }

  private get pool(): ProxyState[] {
    return this.proxies.length ? this.proxies : [this.direct]
  }

  private domain(name: string): DomainState {
    let d = this.domains.get(name)
    if (!d) {
      d = { recent: [], rejections: [] }
      this.domains.set(name, d)
    }
    return d
  }

  /**
   * Waits for an IP with capacity for this provider and company, round-robin.
   * Throws `VerificationLimitError` straight away for limits that waiting a
   * minute won't clear (paused, daily caps), and after `maxWaitMs` otherwise.
   */
  async acquire(provider: MailProvider, domain?: string, opts: { maxWaitMs?: number } = {}): Promise<Lease> {
    const deadline = this.opts.now() + (opts.maxWaitMs ?? this.opts.maxWaitMs)
    const target = domain?.toLowerCase()
    for (;;) {
      const now = this.opts.now()
      this.prune(now)

      if (target) {
        const rejected = this.domain(target).rejections.length
        if (rejected >= this.opts.rejectionsPerDomainPerDay) {
          throw new VerificationLimitError(
            `${target} has rejected ${rejected} guessed addresses today, so checks there wait until tomorrow (many rejections looks like address harvesting to mail servers).`,
            'domain_rejections',
          )
        }
      }

      // Usable IPs: not paused, not benched, under today's cap.
      const cap = this.opts.dailyCapPerIp()
      const reasons = this.pool.map((p) => this.opts.pausedReason(p.config))
      const usable = this.pool.filter((p, i) => !reasons[i] && p.benchedUntil <= now && p.today.length < cap)
      if (usable.length === 0) throw this.nothingUsable(reasons, cap, now)

      const domainOk = !target || this.domain(target).recent.length < this.opts.perDomainBurst
      if (domainOk) {
        for (let i = 0; i < this.pool.length; i++) {
          const p = this.pool[(this.cursor + i) % this.pool.length]
          if (!usable.includes(p)) continue
          if (p.recent.length >= this.opts.perProxyPerMinute) continue
          if (p.providerRecent[provider].length >= this.opts.perProviderPerMinute[provider]) continue
          this.cursor = (this.cursor + i + 1) % this.pool.length
          return this.lease(p, provider, target, now)
        }
      }

      if (now >= deadline) {
        throw new VerificationLimitError(
          domainOk
            ? 'Verification is at its per-minute limit. Try again in a minute.'
            : `${target} has been checked a lot in the last few minutes; checks there are paced to avoid looking like harvesting. Try again in a minute.`,
          'busy',
        )
      }
      await this.opts.sleep(Math.min(1_000, Math.max(50, deadline - now)))
    }
  }

  private nothingUsable(reasons: Array<string | null>, cap: number, now: number): VerificationLimitError {
    const paused = reasons.filter(Boolean) as string[]
    if (paused.length === this.pool.length) return new VerificationLimitError(`Verification is paused: ${paused[0]}`, 'paused')
    if (this.pool.every((p, i) => reasons[i] || p.today.length >= cap)) {
      return new VerificationLimitError(
        `Today's verification limit is used up (${cap} checks per IP). Add another verification server or raise the limit in Settings → Prospecting.`,
        'daily_cap',
      )
    }
    const benched = this.pool.find((p) => p.benchedUntil > now)
    return new VerificationLimitError(
      `All verification IPs are temporarily paused after repeated blocks${benched ? `, until ${new Date(benched.benchedUntil).toLocaleTimeString()}` : ''}. Try again later.`,
      'benched',
    )
  }

  private lease(p: ProxyState, provider: MailProvider, domain: string | undefined, now: number): Lease {
    p.recent.push(now)
    p.providerRecent[provider].push(now)
    p.today.push(now)
    if (domain) this.domain(domain).recent.push(now)
    let reported = false
    return {
      proxy: p.config,
      report: (outcome, rejected) => {
        if (reported) return
        reported = true
        if (rejected && domain) this.domain(domain).rejections.push(this.opts.now())
        this.record(p, outcome)
      },
    }
  }

  private record(p: ProxyState, outcome: CheckOutcome) {
    p.lastResults.push(outcome === 'blocked')
    if (p.lastResults.length > this.opts.blockRateWindow) p.lastResults.shift()

    if (outcome === 'ok') {
      p.ok++
      p.consecutiveFailures = 0
      p.consecutiveUnreachable = 0
    } else if (outcome === 'unreachable') {
      p.unreachable++
      if (++p.consecutiveUnreachable >= this.opts.benchAfterUnreachable) this.bench(p, this.opts.benchMs)
    } else if (outcome === 'greylisted') {
      // Greylisting is the receiving server's normal "come back later", not a
      // sign the IP is burned, so it doesn't count toward benching.
      p.greylisted++
    } else {
      if (outcome === 'blocked') p.blocked++
      else p.timeouts++
      if (++p.consecutiveFailures >= this.opts.benchAfter) this.bench(p, this.opts.benchMs)
    }

    // Mostly blocked lately, even if not in a row: mail servers have started
    // distrusting this IP, so give it a longer rest and say so.
    const blocked = p.lastResults.filter(Boolean).length
    if (p.lastResults.length >= this.opts.blockRateMinChecks && blocked / p.lastResults.length >= this.opts.blockRatePause) {
      const share = Math.round((blocked / p.lastResults.length) * 100)
      this.bench(p, this.opts.blockRatePauseMs)
      p.lastResults = []
      this.opts.onPause(p.label, `${share}% of its last checks were blocked, so it's paused for ${Math.round(this.opts.blockRatePauseMs / MINUTE)} minutes.`)
    }
  }

  private bench(p: ProxyState, ms: number) {
    p.benchedUntil = this.opts.now() + ms
    p.consecutiveFailures = 0
    p.consecutiveUnreachable = 0
    console.warn(`[ProxyRouter] Benched ${p.label} for ${Math.round(ms / MINUTE)} min`)
  }

  private prune(now: number) {
    const minuteAgo = now - MINUTE
    const dayAgo = now - DAY
    for (const p of this.pool) {
      p.recent = p.recent.filter((t) => t > minuteAgo)
      for (const k of Object.keys(p.providerRecent) as MailProvider[]) {
        p.providerRecent[k] = p.providerRecent[k].filter((t) => t > minuteAgo)
      }
      if (p.today.length && p.today[0] <= dayAgo) p.today = p.today.filter((t) => t > dayAgo)
    }
    const windowStart = now - this.opts.domainWindowMs
    for (const [name, d] of this.domains) {
      d.recent = d.recent.filter((t) => t > windowStart)
      d.rejections = d.rejections.filter((t) => t > dayAgo)
      if (!d.recent.length && !d.rejections.length) this.domains.delete(name)
    }
  }

  health(): ProxyHealth[] {
    const now = this.opts.now()
    this.prune(now)
    const cap = this.opts.dailyCapPerIp()
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
        paused: this.opts.pausedReason(p.config),
        checksToday: p.today.length,
        dailyCap: cap,
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
