// Process-wide singletons built from env: the data source, the proxy router
// and the email finder's dependencies. Everything else in `prospecting/` takes
// these as arguments so it can be tested without network or disk.

import { promises as dns } from 'dns'
import { env } from '../env'
import type { FinderDeps } from './emailFinder'
import { ProxyRouter, parseProxyConfig } from './proxyRouter'
import { checkEmail } from './reacher'
import { getReacherConfig, requireSocialFetchKey } from './settings'
import { createSocialFetchSource } from './socialfetch'
import type { CompanySource, PeopleSource } from './types'

let source: (CompanySource & PeopleSource) | null = null
let router: ProxyRouter | null = null

export function getSource(): CompanySource & PeopleSource {
  source ??= createSocialFetchSource(fetch, requireSocialFetchKey)
  return source
}

export function getProxyRouter(): ProxyRouter {
  router ??= new ProxyRouter(parseProxyConfig(env.reacher.proxies()))
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

export async function getFinderDeps(): Promise<FinderDeps> {
  const { db } = await import('../db')
  // Read once per save, so a Reacher URL changed mid-save doesn't split a job.
  const reacher = getReacherConfig()
  return {
    getDomain: (d) => db.getEmailDomain(d),
    updateDomain: (d, patch) => db.upsertEmailDomain(d, patch),
    resolveMx,
    verifier: reacher
      ? {
          acquire: (provider) => getProxyRouter().acquire(provider),
          check: (email, lease) => checkEmail(email, lease.proxy, reacher),
        }
      : null,
    now: () => Date.now(),
  }
}
