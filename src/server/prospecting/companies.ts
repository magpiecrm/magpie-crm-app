import { companyKey } from './socialfetch'
import { normaliseDomain } from './suppression'
import { CompanyUnconfirmed, type CompanySource, type PersonResult } from './types'

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
    let company
    try {
      company = await source.getCompany(ref, pageSlug)
    } catch (err) {
      // Nothing learned: not remembered, so it's asked about again next time.
      if (err instanceof CompanyUnconfirmed) return null
      throw err
    }
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

type CachedCompany = NonNullable<ReturnType<Db['getProspectCompany']>>

/**
 * Finds the company the cache knows by a name, for someone whose profile
 * names their employer without linking its company page. Only when exactly
 * one company goes by the name: with two, there's no telling which. The
 * cache is read once, so make one of these per job.
 */
export function companyNamer(db: Db): (name: string) => CachedCompany | null {
  let byName: Map<string, CachedCompany | null> | null = null
  return (name) => {
    if (!byName) {
      byName = new Map()
      for (const c of db.data.prospect_companies ?? []) {
        const key = companyKey(c.name)
        if (key) byName.set(key, byName.has(key) ? null : c)
      }
    }
    const key = companyKey(name)
    return (key && byName.get(key)) || null
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
  // An employer named without its company page: the one company we know by that name, if there is one.
  const named = !person.companyRef && person.company.trim() ? companyNamer(db)(person.company) : null
  if (named?.domain_source === 'user' && named.domain) return named.domain
  const ref = person.companyRef ?? named?.ref ?? null
  const domain = ref ? await resolveCompanyDomain(ref, person.company, source, db, person.companySlug ?? named?.slug) : null
  // Which company a lookup stopped at for want of a website, for the log. Company
  // data only: an employer without a company page is named by nothing, since
  // its name would come from the person's own headline.
  if (!domain) {
    console.log(`[EmailFinder] no website known for ${ref ? `company ${ref} (${named?.name ?? person.company})${named ? ', matched by name' : ''}` : 'an employer with no company page'} -> no_domain`)
  }
  return domain
}
