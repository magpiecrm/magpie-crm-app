import { companyKey, sameCompanyName } from './socialfetch'
import { normaliseDomain } from './suppression'
import { findCompanySite, type CompanyPageReader } from './companySite'
import { webSearcher, type WebSearch } from './webSearch'
import { CompanyUnconfirmed, type CompanySource, type PersonResult } from './types'

type Db = typeof import('../db')['db']

// Several people at one company in a single save should cost one company-page
// lookup, not one each.
const inflight = new Map<string, Promise<string | null | undefined>>()

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
  return (await companyWebsite(ref, fallbackName, source, db, slug)) ?? null
}

/**
 * The same, telling a company whose page lists no website (null) from one
 * whose page couldn't be read just now (undefined): only the first says
 * there's no website there to be had.
 */
export async function companyWebsite(
  ref: string,
  fallbackName: string,
  source: Pick<CompanySource, 'getCompany'>,
  db: Db,
  slug?: string | null,
): Promise<string | null | undefined> {
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
      if (err instanceof CompanyUnconfirmed) return undefined
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
      headcount_exact: company?.headcountExact,
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

/**
 * Words people type as their employer to say what they do rather than who
 * for: "clean", "food industry", "real estate". LinkedIn's search files
 * them under a company page of that name, and there usually is one (an
 * agency called Clean), so a name made only of these, typed in rather than
 * linked to a page, places nobody anywhere.
 */
const LINE_OF_WORK = new Set(
  `accounting acting actor advertising agriculture apparel architecture art artist arts author automotive aviation baking banking barber
  beauty beverage blogger blogging bookkeeping building business care caregiver carpentry catering childcare cleaner cleaning clean clothing
  coach coaching commerce communications construction consultancy consulting content cosmetics cosmetology crafts creative customer dental
  design designer developer digital distribution driver driving ecommerce education electrical employed employment energy engineering
  entertainment entrepreneur entrepreneurship events export family farm farming fashion film finance financial fitness food freelancing
  gaming gas government hair handyman health healthcare home hospitality housekeeping hr import influencer insurance internet investing
  investments investor it janitorial jewelry job jobs journalism landscaping law legal logistics maintenance management manufacturing
  marketing me media medical military mining ministry music musician my myself nanny nonprofit nursing oil online other own owner painting
  personal pharmacy photographer photography plumbing podcast pr printing production property publishing radio real estate recruiting
  recruitment relations restaurant restaurants retail roofing sales salon school security service services shipping social software sports
  staffing startup student teaching tech technology telecom telecommunications television tourism trader trading training transportation
  travel trucking tutor tutoring tv video volunteer volunteering web wellness wholesale work working writer writing`
    .split(/\s+/)
    .filter(Boolean),
)
/** "The food industry", "hospitality sector": the same, said in full. */
const SAID_IN_FULL = new Set(['industry', 'sector', 'field', 'trade', 'and', 'of', 'in', 'at'])

/** Whether a word names a line of work ("marketing", "media") rather than anyone in particular. */
export const isLineOfWork = (word: string) => LINE_OF_WORK.has(word.toLowerCase())

const describesWork = (key: string) => {
  const words = key.split(' ')
  return words.length <= 4 && words.some((w) => LINE_OF_WORK.has(w)) && words.every((w) => LINE_OF_WORK.has(w) || SAID_IN_FULL.has(w))
}

/**
 * Whether an employer's name, typed on a profile, could be a company's,
 * rather than "Self-employed", "clean" and the like. Someone whose profile
 * links a company's page works there whatever it's called; this is only for
 * names with no page behind them.
 */
export const isCompanyName = (name: string) => {
  const key = companyKey(name)
  return key.length >= 3 && !NOT_A_COMPANY.has(key) && !describesWork(key)
}

/**
 * Whether an employer named on a profile is the company called `name`, by
 * name alone. The same name, or one starting with the other ("Barclays UK"
 * for Barclays), but only where what they share tells firms apart: at least
 * four letters besides words for a line of work. LinkedIn files everyone who
 * typed "MCS", "MCS Inc" or "MCS Management Corp" under a company page called
 * MCS Management Consulting & Selection, and they work at hundreds of
 * different MCSes. `linked`: the profile links a company page (whose id may
 * be in another form than ours), so the same name exactly is enough.
 */
export function plainlySameCompany(employer: string, name: string, linked: boolean): boolean {
  if (!sameCompanyName(employer, name)) return false
  const [a, b] = [companyKey(employer), companyKey(name)]
  if (linked && a === b) return true
  const shared = a.length <= b.length ? a : b
  return shared.split(' ').filter((w) => !isLineOfWork(w)).join('').length >= 4
}

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
 * The company at a LinkedIn page, when the page's own name is this name
 * once "Ltd" and the like are set aside: nearly the same isn't enough to
 * take a page for an employer. It goes in the company cache. Throws
 * CompanyUnconfirmed when the host couldn't read the page.
 */
async function companyAtPage(pageName: string, name: string, source: Pick<CompanySource, 'getCompany'>, db: Db): Promise<KnownCompany | null> {
  const company = await source.getCompany(pageName, pageName, { pageOnly: true })
  if (!company || companyKey(company.name) !== companyKey(name) || !sameCompanyName(company.name, name)) return null
  db.upsertProspectCompanies([{ ref: company.ref, name: company.name, domain: company.domain, domain_source: 'socialfetch', page_checked: true, headcount: company.headcount, slug: pageName, headcount_exact: company.headcountExact }])
  return { ref: company.ref, name: company.name, domain: company.domain, slug: pageName }
}

/** Reads the website off a LinkedIn company page a web search turned up for an employer (companySite.ts). */
export const companyPageReader =
  (name: string, source: Pick<CompanySource, 'getCompany'>, db: Db): CompanyPageReader =>
  async (pageName) =>
    (await companyAtPage(pageName, name, source, db))?.domain ?? null

/**
 * Finds an employer's company page when a profile names it without linking
 * it: asks for the page its name would have, and takes it only when the
 * page's own name is the same. Many people type their employer in rather
 * than pick its page, so the page often exists all the same. Found ones go
 * in the company cache; nothing is learned from a page the host couldn't read.
 */
export async function findCompanyByName(name: string, source: Pick<CompanySource, 'getCompany'>, db: Db): Promise<KnownCompany | null> {
  const key = companyKey(name)
  if (!key || NOT_A_COMPANY.has(key) || describesWork(key)) return null
  const now = Date.now()
  const before = guessed.get(key)
  if (before && now - before.at < GUESS_KEPT_MS) return before.found
  const found = (async () => {
    for (const pageName of pageNamesFor(name)) {
      try {
        const company = await companyAtPage(pageName, name, source, db)
        if (company) return company
      } catch (err) {
        if (err instanceof CompanyUnconfirmed) {
          guessed.delete(key)
          return null
        }
        throw err
      }
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
export async function domainForPerson(
  person: PersonResult,
  source: CompanySource,
  db: Db,
  /** A web search to fall back on (webSearch.ts); this copy's own unless given, and none when it has none. */
  search: WebSearch | null = webSearcher(),
): Promise<string | null> {
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
  let domain = ref ? await resolveCompanyDomain(ref, person.company, source, db, person.companySlug ?? named?.slug) : null
  // No company page, or none with a website: the company's own site by web search, when it's plainly theirs.
  // Or, for an employer with no page we know of, off the page the search turns up.
  if (!domain && search && isCompanyName(named?.name ?? person.company)) {
    domain = await findCompanySite(named?.name ?? person.company, person.country, search, db, Date.now(), ref ? undefined : companyPageReader(person.company, source, db))
  }
  // Which company a lookup stopped at for want of a website, for the log. Company
  // data only: an employer without a company page is named by nothing, since
  // its name would come from the person's own headline.
  if (!domain) {
    console.log(`[EmailFinder] no website known for ${ref ? `company ${ref} (${named?.name ?? person.company})${named ? ', matched by name' : ''}` : 'an employer with no company page'} -> no_domain`)
  }
  return domain
}
