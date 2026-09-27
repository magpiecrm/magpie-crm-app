import { normaliseDomain } from './suppression'
import type { CompanySource, PersonResult } from './types'

type Db = typeof import('../db')['db']

// Several people at one company in a single save should cost one company-page
// lookup, not one each.
const inflight = new Map<string, Promise<string | null>>()

/**
 * The company's mail domain: from the cache when known, otherwise from its
 * SocialFetch company page (1 credit with the page name, 6-9 without), fetched
 * at most once per company — a page with no website is remembered so it isn't
 * paid for again.
 */
export async function resolveCompanyDomain(
  ref: string,
  fallbackName: string,
  source: Pick<CompanySource, 'getCompany'>,
  db: Db,
  slug?: string | null,
): Promise<string | null> {
  const cached = db.getProspectCompany(ref)
  if (cached?.domain || cached?.page_checked || cached?.domain_source === 'user') return cached.domain

  const pending = inflight.get(ref)
  if (pending) return pending
  const task = (async () => {
    const pageSlug = slug ?? cached?.slug ?? null
    const company = await source.getCompany(ref, pageSlug)
    db.upsertProspectCompanies([{
      ref,
      name: company?.name ?? cached?.name ?? fallbackName,
      domain: company?.domain ?? null,
      domain_source: 'socialfetch',
      page_checked: true,
      headcount: company?.headcount ?? null,
      slug: pageSlug,
    }])
    return company?.domain ?? null
  })()
  inflight.set(ref, task)
  try {
    return await task
  } finally {
    inflight.delete(ref)
  }
}

/**
 * The email domain to use for a person. A domain the user set for their
 * company always wins (it's how a wrong LinkedIn website gets corrected, e.g.
 * jlr.com -> jaguarlandrover.com), even over one already attached to a search
 * result from before the correction.
 */
export async function domainForPerson(person: PersonResult, source: CompanySource, db: Db): Promise<string | null> {
  if (person.companyRef) {
    const cached = db.getProspectCompany(person.companyRef)
    if (cached?.domain_source === 'user' && cached.domain) return cached.domain
  }
  if (person.companyDomain) return normaliseDomain(person.companyDomain)
  if (person.companyRef) return resolveCompanyDomain(person.companyRef, person.company, source, db, person.companySlug)
  return null
}
