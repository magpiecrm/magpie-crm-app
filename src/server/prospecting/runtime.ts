// Process-wide singletons built from env: the data source, the proxy router
// and the email finder's dependencies. Everything else in `prospecting/` takes
// these as arguments so it can be tested without network or disk.

import { promises as dns } from 'dns'
import type { FinderDeps } from './emailFinder'
import { ProxyRouter } from './proxyRouter'
import { suggestMailDomain } from './mailDomainHint'
import { checkEmail } from './reacher'
import { getActiveVerifier, getProxyConfigs, getVerificationDailyCap, requireSocialFetchKey } from './settings'
import { verificationPauseReason } from './senderHealthMonitor'
import { createSocialFetchSource } from './socialfetch'
import { withProfileCache } from './profileCache'
import type { CompanySource, PeopleSource } from './types'

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
 * The router is rebuilt when the proxy list changes in Settings (which also
 * resets its health counters); otherwise it's shared so rate limits hold
 * across concurrent saves and reveals.
 */
export function getProxyRouter(): ProxyRouter {
  const { proxies } = getProxyConfigs()
  const key = JSON.stringify(proxies.map((p) => [p.host, p.port, p.username, p.password]))
  if (!router || key !== routerKey) {
    router = new ProxyRouter(proxies, {
      dailyCapPerIp: getVerificationDailyCap,
      pausedReason: verificationPauseReason,
      onPause: (label, reason) => {
        import('../notify')
          .then(({ notify }) => notify('verifier_alert', `Email verification: ${label} — ${reason}`))
          .catch((err) => console.error('[ProxyRouter] notify failed:', err))
      },
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
  }
}
