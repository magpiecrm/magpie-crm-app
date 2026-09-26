// Process-wide singletons built from env: the data source, the proxy router
// and the email finder's dependencies. Everything else in `prospecting/` takes
// these as arguments so it can be tested without network or disk.

import { promises as dns } from 'dns'
import type { FinderDeps } from './emailFinder'
import { ProxyRouter } from './proxyRouter'
import { checkEmailNeverBounce } from './neverbounce'
import { suggestMailDomain } from './mailDomainHint'
import { checkEmail, type ReacherCheckConfig } from './reacher'
import type { MailProvider } from './proxyRouter'
import { withFallback } from './verifiers'
import { getActiveVerifier, getProxyConfigs, requireSocialFetchKey } from './settings'
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
    router = new ProxyRouter(proxies)
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

/** One Reacher check through the proxy router (rate limits, health, benching). */
async function reacherCheck(email: string, provider: MailProvider, config: ReacherCheckConfig) {
  const lease = await getProxyRouter().acquire(provider)
  const result = await checkEmail(email, lease.proxy, config)
  lease.report(result.outcome)
  return result
}

export async function getFinderDeps(): Promise<FinderDeps> {
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
            acquire: (provider) => getProxyRouter().acquire(provider),
            check: (email, lease) => checkEmail(email, lease.proxy, active.reacher),
          }
        : active?.provider === 'neverbounce'
          ? (() => {
              const neverbounce = (email: string) => checkEmailNeverBounce(email, active.apiKey)
              const fallback = active.fallback
              const check = fallback
                ? withFallback(neverbounce, (email, provider) => reacherCheck(email, provider, fallback))
                : neverbounce
              return {
                // NeverBounce connects to mail servers itself; only the
                // Reacher fallback goes through the proxy router.
                acquire: async () => ({ proxy: null, report: () => {} }),
                check: (email: string, _lease: unknown, provider: MailProvider) => check(email, provider),
                detectsCatchAll: true,
              }
            })()
          : null,
    now: () => Date.now(),
    suggestMailDomain: (domain) => suggestMailDomain(domain, { resolveSoaContact, resolveMx }),
  }
}
