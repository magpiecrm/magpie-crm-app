// Process-wide singletons built from env: the data source, the proxy router
// and the email finder's dependencies. Everything else in `prospecting/` takes
// these as arguments so it can be tested without network or disk.

import { promises as dns } from 'dns'
import type { FinderDeps } from './emailFinder'
import { ProxyRouter, type RouterOptions } from './proxyRouter'
import { suggestMailDomain } from './mailDomainHint'
import { checkEmail } from './reacher'
import { getActiveVerifier, getProxyConfigs, getVerificationDailyCap, isSocialFetchConfigured, requireSocialFetchKey } from './settings'
import { verificationPauseReason } from './senderHealthMonitor'
import { createSocialFetchSource, type JoinerStore } from './socialfetch'
import { db } from '../db'
import { withProfileCache } from './profileCache'
import { CompanyUnconfirmed, ProfileUnconfirmed, type CompanySource, type PeopleSource } from './types'
import { hostCheckShare, hostWebPeopleSearch, prospectingRules, type CheckShare } from './hostRules'
import { createWebSource } from './webSource'
import { webSearcher } from './webSearch'
import { env } from '../env'
import { cachedSharedFormat, sharedFormat } from './sharedFormats'

let source: (CompanySource & PeopleSource) | null = null
let sourceKind = ''
let router: ProxyRouter | null = null
let routerKey = ''

/** How SocialFetch takes multi-word titles, kept in the prospecting settings so a restart doesn't pay to find out again. */
const joinerStore: JoinerStore = {
  get() {
    const kept = db.getProspectingSettings()?.title_joiner
    return kept ? { joiner: kept.joiner, confirmedAt: kept.confirmed_at } : null
  },
  set({ joiner, confirmedAt }) {
    const current = db.getProspectingSettings()
    db.saveProspectingSettings({ ...current, title_joiner: { joiner, confirmed_at: confirmedAt }, updated_at: current?.updated_at ?? new Date().toISOString() })
  },
}

/**
 * Lookups for a copy with web people search and no SocialFetch key (nor a
 * host to answer them): nothing can be looked up, so every profile and
 * company page is unconfirmed, and people keep what the search said.
 */
const noLookups: CompanySource & PeopleSource = {
  searchCompanies: async () => {
    throw new Error('Company search needs a data source. Search for people by job title instead.')
  },
  getCompany: async () => {
    throw new CompanyUnconfirmed()
  },
  searchPeople: async () => {
    throw new Error('No people search is set up.')
  },
  getPerson: async () => {
    throw new ProfileUnconfirmed()
  },
}

/**
 * People are found by web search of public LinkedIn profiles (webSource.ts):
 * where the host has switched it on for a hosted copy, or a copy with its own
 * web search key sets PEOPLE_SEARCH=web.
 */
function webPeopleSearch(): boolean {
  return env.prospectingManaged() ? hostWebPeopleSearch() : env.webSearch.people() && Boolean(env.webSearch.apiKey())
}

export function getSource(): CompanySource & PeopleSource {
  // The host's switch can change while the copy runs (hostRules.ts), so the source is built for the current one.
  const kind = webPeopleSearch() ? 'web' : 'socialfetch'
  if (!source || kind !== sourceKind) {
    const socialfetch = createSocialFetchSource(fetch, requireSocialFetchKey, { joiner: joinerStore })
    const search = kind === 'web' ? webSearcher() : null
    // Profile and company lookups (and company search) still go to SocialFetch's API: in a hosted
    // copy, the host, which answers them from LinkedIn's public pages.
    const lookups = env.prospectingManaged() || isSocialFetchConfigured() ? socialfetch : noLookups
    // Profile lookups are remembered for a day (in memory only), so a person who
    // turns up again isn't paid for twice.
    source = withProfileCache(search ? createWebSource(search, lookups) : socialfetch)
    sourceKind = kind
  }
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

/** The share of the verification allowance that checks made ahead of time leave for Reveals and saves. */
const AHEAD_LEAVES_FREE = 0.5

/**
 * `background`: a save job, which can wait out a company's pacing (minutes);
 * a Reveal, where someone is watching, gives up sooner with a clear message.
 * `ahead`: a search testing companies' mail domains before anyone asks for an
 * email there. Nobody is waiting on those, so they take only what's spare
 * (half of each minute's and each day's checks), and wait their turn for
 * minutes rather than give up: a test that finishes after its people were
 * shown is still there for the next search and for a Reveal.
 */
export async function getFinderDeps(opts: { background?: boolean; ahead?: boolean } = {}): Promise<FinderDeps> {
  const maxWaitMs = opts.ahead ? 5 * 60_000 : opts.background ? 10 * 60_000 : 90_000
  const leaveFree = opts.ahead ? AHEAD_LEAVES_FREE : undefined
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
            acquire: (provider, domain) => getProxyRouter().acquire(provider, domain, { maxWaitMs, leaveFree }),
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
