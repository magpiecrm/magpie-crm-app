import { companyKey, sameCompanyName } from './socialfetch'
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
/** As much of a company as placing someone there takes. */
type KnownCompany = Pick<CachedCompany, 'ref' | 'name' | 'domain'> & Partial<Pick<CachedCompany, 'slug' | 'domain_source'>>

/**
 * Finds the company the cache knows by a name, for someone whose profile
 * names their employer without linking its company page. Only when exactly
 * one company goes by the name: with `several`, there's no telling which.
 * The cache is read once, so make one of these per job.
 */
export function companyNamer(db: Db): (name: string) => CachedCompany | 'several' | null {
  let byName: Map<string, CachedCompany | 'several'> | null = null
  return (name) => {
    if (!byName) {
      byName = new Map()
      for (const c of db.data.prospect_companies ?? []) {
        const key = companyKey(c.name)
        if (key) byName.set(key, byName.has(key) ? 'several' : c)
      }
    }
    const key = companyKey(name)
    return (key && byName.get(key)) || null
  }
}

/** What people put as their employer when it isn't a company; LinkedIn has pages by some of these names. */
const NOT_A_COMPANY = new Set(
  ['self employed', 'selfemployed', 'freelance', 'freelancer', 'independent', 'independent consultant', 'consultant', 'stealth', 'stealth startup', 'confidential', 'private', 'retired', 'unemployed', 'career break', 'various', 'n a', 'none'].map(
    (n) => companyKey(n),
  ),
)

/** The page names a company's LinkedIn page might have, from its name: "Research Works Ltd" -> research-works-ltd, research-works. */
export function pageNamesFor(name: string): string[] {
  const full = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const short = full.replace(/-(ltd|limited|llp|plc|inc|llc)$/, '')
  return [...new Set([full, short])].filter((s) => s.length >= 2)
}

// Names asked about lately and what came of it, so several people at one
// employer cost one look. In memory only: an employer's name can be a
// person's ("Jane Smith Consulting").
const guessed = new Map<string, { at: number; found: Promise<KnownCompany | null> }>()
const GUESS_KEPT_MS = 24 * 60 * 60_000
/** For tests: forget what's been asked about. */
export const forgetCompanyGuesses = () => guessed.clear()

/**
 * Finds an employer's company page when a profile names it without linking
 * it: asks for the page its name would have, and takes it only when the
 * page's own name is the same. Many people type their employer in rather
 * than pick its page, so the page often exists all the same. Found ones go
 * in the company cache; nothing is learned from a page the host couldn't read.
 */
export async function findCompanyByName(name: string, source: Pick<CompanySource, 'getCompany'>, db: Db): Promise<KnownCompany | null> {
  const key = companyKey(name)
  if (!key || NOT_A_COMPANY.has(key)) return null
  const now = Date.now()
  const before = guessed.get(key)
  if (before && now - before.at < GUESS_KEPT_MS) return before.found
  const found = (async () => {
    for (const pageName of pageNamesFor(name)) {
      let company
      try {
        company = await source.getCompany(pageName, pageName, { pageOnly: true })
      } catch (err) {
        if (err instanceof CompanyUnconfirmed) {
          guessed.delete(key)
          return null
        }
        throw err
      }
      // The same name once "Ltd" and the like are set aside: nearly the same isn't enough for a guess.
      if (!company || companyKey(company.name) !== key || !sameCompanyName(company.name, name)) continue
      db.upsertProspectCompanies([{ ref: company.ref, name: company.name, domain: company.domain, domain_source: 'socialfetch', page_checked: true, headcount: company.headcount, slug: pageName }])
      return { ref: company.ref, name: company.name, domain: company.domain, slug: pageName }
    }
    return null
  })()
  if (guessed.size > 2_000) guessed.clear()
  guessed.set(key, { at: now, found })
  found.catch(() => guessed.delete(key))
  return found
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
  // Or, when we know none by it, the page its name would have, if it turns out to be that company's.
  let named: KnownCompany | null = null
  if (!person.companyRef && person.company.trim()) {
    const known = companyNamer(db)(person.company)
    named = known === 'several' ? null : (known ?? (await findCompanyByName(person.company, source, db)))
  }
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
