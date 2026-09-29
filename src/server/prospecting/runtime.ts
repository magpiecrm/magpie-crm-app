// Process-wide singletons built from env: the data source, the proxy router
// and the email finder's dependencies. Everything else in `prospecting/` takes
// these as arguments so it can be tested without network or disk.

import { promises as dns } from 'dns'
import type { FinderDeps } from './emailFinder'
import { ProxyRouter, type RouterOptions } from './proxyRouter'
import { suggestMailDomain } from './mailDomainHint'
import { checkEmail } from './reacher'
import { getActiveVerifier, getProxyConfigs, getVerificationDailyCap, requireSocialFetchKey } from './settings'
import { verificationPauseReason } from './senderHealthMonitor'
import { createSocialFetchSource } from './socialfetch'
import { withProfileCache } from './profileCache'
import type { CompanySource, PeopleSource } from './types'
import { hostCheckShare, prospectingRules, type CheckShare } from './hostRules'
import { env } from '../env'
import { cachedSharedFormat, sharedFormat } from './sharedFormats'

let source: (CompanySource & PeopleSource) | null = null
let router: ProxyRouter | null = null
let routerKey = ''

export function getSource(): CompanySource & PeopleSource {
  // Profile lookups are remembered for a day (in memory only), so a person who
  // turns up again isn't paid for twice.
  source ??= withProfileCache(createSocialFetchSource(fetch, requireSocialFetchKey))
  return source
}

/**
 * In a hosted copy, checks go to the host, which spreads them over its own
 * IPs, paces each mail provider and watches each IP's health, and gives each
 * customer a share of checks per minute and per day. So the router here only
 * paces to that share (queueing checks rather than having the host turn the
 * excess away) and keeps its per-company limits; it never benches or pauses
 * "the IP", which is the host.
 */
export function hostedRouterOptions(share: CheckShare): Partial<RouterOptions> {
  const perMinute = share.perMinute
  return {
    perProxyPerMinute: perMinute,
    // What the host's IPs can take from each provider, so checks queue here
    // rather than waiting at the host until they time out.
    perProviderPerMinute: share.perProvider ?? { google: perMinute, microsoft: perMinute, other: perMinute },
    dailyCapPerIp: () => share.perDay,
    dailyCapMessage: (cap) => `Your account's email verification limit for today (${cap} checks) is used up. It frees up over the next 24 hours.`,
    benchAfter: Number.MAX_SAFE_INTEGER,
    benchAfterUnreachable: Number.MAX_SAFE_INTEGER,
    blockRatePause: 2,
  }
}

/** Until the host says (hostRules.ts), the share hosts give by default. */
const DEFAULT_HOST_SHARE = { perMinute: 15, perDay: 600 }

/**
 * The router is rebuilt when the proxy list changes in Settings (which also
 * resets its health counters), or a hosted copy's share changes; otherwise
 * it's shared so rate limits hold across concurrent saves and reveals.
 */
export function getProxyRouter(): ProxyRouter {
  const { proxies } = getProxyConfigs()
  const hosted = env.prospectingManaged() && proxies.length === 0
  const share = hosted ? (hostCheckShare() ?? DEFAULT_HOST_SHARE) : null
  const key = JSON.stringify([proxies.map((p) => [p.host, p.port, p.username, p.password]), share])
  if (!router || key !== routerKey) {
    router = new ProxyRouter(proxies, {
      dailyCapPerIp: getVerificationDailyCap,
      pausedReason: verificationPauseReason,
      onPause: (label, reason) => {
        import('../notify')
          .then(({ notify }) => notify('verifier_alert', `Email verification: ${label} — ${reason}`))
          .catch((err) => console.error('[ProxyRouter] notify failed:', err))
      },
      ...(share ? hostedRouterOptions(share) : {}),
    })
    routerKey = key
  }
  return router
}

async function resolveMx(domain: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(domain)
    // A "null MX" (`0 .`, RFC 7505) is the domain saying it takes no mail.
    return records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange)
      .filter((host) => host && host !== '.')
  } catch (err: any) {
    // "No such domain" / "no MX" is an answer; anything else is a failure.
    if (err?.code === 'ENOTFOUND' || err?.code === 'ENODATA') return []
    throw err
  }
}

async function resolveSoaContact(domain: string): Promise<string | null> {
  try {
    return (await dns.resolveSoa(domain)).hostmaster || null
  } catch {
    return null
  }
}

/**
 * `background`: a save job, which can wait out a company's pacing (minutes);
 * a Reveal, where someone is watching, gives up sooner with a clear message.
 */
export async function getFinderDeps(opts: { background?: boolean } = {}): Promise<FinderDeps> {
  const maxWaitMs = opts.background ? 10 * 60_000 : 90_000
  const { db } = await import('../db')
  // Read once per save, so a settings change mid-save doesn't split a job.
  const active = getActiveVerifier()
  return {
    getDomain: (d) => db.getEmailDomain(d),
    updateDomain: (d, patch) => db.upsertEmailDomain(d, patch),
    resolveMx,
    verifier:
      active?.provider === 'reacher'
        ? {
            acquire: (provider, domain) => getProxyRouter().acquire(provider, domain, { maxWaitMs }),
            check: (email, lease) => checkEmail(email, lease.proxy, active.reacher),
          }
        : null,
    now: () => Date.now(),
    suggestMailDomain: (domain) => suggestMailDomain(domain, { resolveSoaContact, resolveMx }),
    knownAddresses: (domain) => db.knownAddressesAt(domain),
    sharedFormat: (domain, headcount) => sharedFormat(domain, headcount),
    cachedSharedFormat: (domain) => cachedSharedFormat(domain),
    formatConfirmedAt: prospectingRules().formatConfirmed,
  }
}
