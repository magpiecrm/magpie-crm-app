// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import { createHash } from 'node:crypto'
import { env } from '../env'
import { refineFromProfile } from './refine'
import { PAGE_SIZES, type CompanyFilters, type CompanyResult, type CompanySource, type Page, type PeopleFilters, type PeopleSource, type PersonResult } from './types'
import { hasConfirmedFormat, isKnownCatchAll, isKnownNoMail, surnameHidden } from './emailFinder'
import { unverifiableHashes } from './unverifiable'
import { sharedCatchAll } from './sharedCatchAll'
import { companyKey, meterCredits, sameCompanyName, searchesForTitles, slugFromCompanyUrl } from './socialfetch'
import { classifySeniority } from './seniority'
import { emailHash, hashesFor, isSuppressed, profileHash } from './suppression'

export async function searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { prospectCredits, remaining, requireAllowance } = await import('../allowance')
  // Browsing companies is searching too: it uses prospect credits for what it costs.
  if (remaining('prospects') < 1) requireAllowance('prospects')
  const { result: page, credits } = await meterCredits(() => getSource().searchCompanies(filters))
  const { recordUsage } = await import('../usage')
  recordUsage({ prospectCredits: prospectCredits(credits) })

  // A domain the user entered by hand beats the provider's (often missing) one.
  for (const company of page.items) {
    const cached = db.getProspectCompany(company.ref)
    if (cached?.domain_source === 'user' || (!company.domain && cached?.domain)) company.domain = cached.domain
  }
  // Mark companies whose mail domain is already known to accept every
  // address: searching for people there can't produce a verified email.
  const now = Date.now()
  const worthIt = await formatConfirmedAt(db)
  for (const company of page.items) {
    if (company.domain && isKnownCatchAll(company.domain, (d) => db.getEmailDomain(d), now) && !worthIt(company.domain)) company.catchAll = true
  }
  // In a hosted copy, also those any other copy there has found out about.
  const unmarked = page.items.filter((c) => !c.catchAll && !(c.domain && worthIt(c.domain)))
  const shared = await sharedCatchAll(unmarked.map((c) => ({ ref: c.ref, domain: c.domain })))
  unmarked.forEach((c, i) => shared[i] && (c.catchAll = true))

  // Companies and domains are non-personal, so they're cached globally.
  db.upsertProspectCompanies(
    page.items.map((c) => ({
      ref: c.ref,
      name: c.name,
      domain: c.domain,
      domain_source: 'socialfetch' as const,
      headcount: c.headcount,
      slug: slugFromCompanyUrl(c.linkedinUrl),
    })),
  )
  return forThisCopy(page)
}

/**
 * The notes a copy shows: its warnings, then the details of how the page was
 * put together, except in a copy whose data is run by its host, where how
 * searches are run and paid for is the host's business.
 */
function forThisCopy<T extends { warnings: string[]; details?: string[] }>(page: T): T {
  const { details = [], ...rest } = page
  return { ...rest, warnings: env.prospectingManaged() ? page.warnings : [...page.warnings, ...details] } as T
}

/** Company with a known domain where possible; fetches the company page once if needed. */
export async function resolveCompany(ref: string): Promise<{ ref: string; domain: string | null; catchAll: boolean }> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { resolveCompanyDomain } = await import('./companies')
  const name = db.getProspectCompany(ref)?.name ?? ref
  const domain = await resolveCompanyDomain(ref, name, getSource(), db)
  // Known here, or (in a hosted copy) by any other copy there: the page asks
  // before spending a search on a company where nothing can be verified.
  if (domain && (await formatConfirmedAt(db))(domain)) return { ref, domain, catchAll: false }
  const catchAll = companyIsCatchAll(domain, db) || (await sharedCatchAll([{ ref, domain }]))[0]
  return { ref, domain, catchAll }
}

/** Whether a company's mail domain is already known to accept every address (cache only). */
export function companyIsCatchAll(domain: string | null, db: Db): boolean {
  return Boolean(domain && isKnownCatchAll(domain, (d) => db.getEmailDomain(d), Date.now()))
}

/**
 * While `format_confirmed` guesses are handed over (Settings → Prospect
 * search), a catch-all company whose format is well established isn't a dead
 * end: this says which, for search not to mark or hide it. Always false
 * otherwise.
 */
async function formatConfirmedAt(db: Db): Promise<(domain: string) => boolean> {
  const { allowsFormatConfirmed } = await import('./settings')
  if (!allowsFormatConfirmed()) return () => false
  const { cachedSharedFormat } = await import('./sharedFormats')
  const { prospectingRules } = await import('./hostRules')
  const deps = {
    getDomain: (d: string) => db.getEmailDomain(d),
    knownAddresses: (d: string) => db.knownAddressesAt(d),
    cachedSharedFormat,
    formatConfirmedAt: prospectingRules().formatConfirmed,
  }
  const now = Date.now()
  const memo = new Map<string, boolean>()
  return (domain) => {
    if (!memo.has(domain)) memo.set(domain, hasConfirmedFormat(domain, deps, now))
    return memo.get(domain)!
  }
}

/** Profile lookups run at once: SocialFetch sets no rate limit, and each takes about 2 seconds. */
const ENRICH_CONCURRENCY = 8

type Db = typeof import('../db')['db']

interface Enriched {
  person: PersonResult
  refined: boolean
  /** The lookup itself failed (e.g. out of credits); nothing was learned. */
  error?: string
}

/** One profile lookup (3 credits): the person's real current title and employer. */
async function enrichOne(person: PersonResult, source: PeopleSource, db: Db): Promise<Enriched> {
  let profile: PersonResult | null
  try {
    profile = await source.getPerson(person.profileUrl)
  } catch (err: any) {
    // Keep the search result rather than failing the whole page the user
    // already paid for; not marked checked, so saving can try again.
    return { person, refined: false, error: String(err?.message ?? err) }
  }
  const refined = refineFromProfile(person, profile)
  if (!refined) return { person: { ...person, profileChecked: true }, refined: false }
  return {
    refined: true,
    person: {
      ...refined,
      profileChecked: true,
      companyDomain: refined.companyRef ? (db.getProspectCompany(refined.companyRef)?.domain ?? null) : person.companyDomain,
    },
  }
}

/**
 * People already saved as contacts are filled in from the contact (title,
 * company, email) instead of paying for their profile again; people only
 * revealed before are marked. Matched through the profile hashes in the
 * disclosure log, so nothing new is stored. Returns how many were saved.
 */
function markPreviouslySeen(items: PersonResult[], db: Db): number {
  const savedAs = new Map<string, string>()
  const revealed = new Set<string>()
  for (const d of db.getDisclosures()) {
    if (!d.profile_hash) continue
    if (d.event === 'saved') savedAs.set(d.profile_hash, d.contact_hash)
    else if (d.event === 'revealed') revealed.add(d.profile_hash)
  }
  if (savedAs.size === 0 && revealed.size === 0) return 0

  let contactsByHash: Map<string, (typeof db.data.contacts)[number]> | null = null
  let saved = 0
  items.forEach((p, i) => {
    const hash = profileHash(p.profileUrl)
    if (!hash) return
    const contactHash = savedAs.get(hash)
    if (contactHash) {
      contactsByHash ??= new Map(db.data.contacts.map((c) => [emailHash(c.email), c]))
      const contact = contactsByHash.get(contactHash)
      // A deleted contact falls through to a normal lookup.
      if (contact) {
        items[i] = {
          ...p,
          title: contact.job_title || p.title,
          seniority: contact.job_title ? classifySeniority(contact.job_title) : p.seniority,
          company: contact.company || p.company,
          email: contact.email,
          emailStatus: contact.email_status,
          previously: 'saved',
          profileChecked: true,
        }
        saved++
        return
      }
    }
    // Their email was never kept, so they're still looked up.
    if (revealed.has(hash)) items[i] = { ...p, previously: 'revealed' }
  })
  return saved
}

const nameKey = (first: string | null | undefined, last: string | null | undefined, domain: string) =>
  `${(first ?? '').trim().toLowerCase()}|${(last ?? '').trim().toLowerCase()}|${domain.toLowerCase()}`

/**
 * Whether a person is already a contact: same first and last name, with an
 * email at their company's domain or the same company name.
 */
function contactMatcher(db: Db): (p: PersonResult) => boolean {
  const keys = new Set<string>()
  for (const c of db.data.contacts) {
    if (!c.first_name || !c.last_name) continue
    const domain = c.email.split('@')[1]
    if (domain) keys.add(nameKey(c.first_name, c.last_name, domain))
    if (c.company && companyKey(c.company)) keys.add(nameKey(c.first_name, c.last_name, `@${companyKey(c.company)}`))
  }
  return (p) =>
    (Boolean(p.companyDomain) && keys.has(nameKey(p.firstName, p.lastName, p.companyDomain!.replace(/^www\./, '')))) ||
    (Boolean(p.company && companyKey(p.company)) && keys.has(nameKey(p.firstName, p.lastName, `@${companyKey(p.company)}`)))
}

/**
 * A headline's title saying they've left their job: "Former CFO", "Ex-Head
 * of Sales", "Retired", "Open to work". Not "Ex-Googler, now …".
 */
const NOT_WORKING = /^(?:(?:ex[-\s]|former\b|formerly\b|retired\b)(?!.*(?:\bnow\b|,|\/))|open to work\b)/i

/**
 * Leaves out, before their profile is paid for, people the search hit already
 * shows aren't worth one: a headline saying they've left their job, an
 * existing contact (same name, and the headline's company or its domain),
 * and, while unverifiable people are hidden, anyone whose headline names a
 * company already known to accept every address or take no email. Only the
 * headline and the company cache are used (never a lookup), so an out-of-date
 * headline can leave out someone who has since moved somewhere verifiable.
 * Returns the profile URLs left out.
 */
async function skipBeforeLookup(
  people: PersonResult[],
  db: Db,
  opts: { hideUnverifiable: boolean; includeContacts: boolean; tally: Tally },
): Promise<Set<string>> {
  const skip = new Set<string>()
  for (const p of people) {
    if (NOT_WORKING.test(p.title.trim())) {
      skip.add(p.profileUrl)
      opts.tally.skippedNotWorking++
    }
  }
  // The headline's company, when the cache knows exactly one domain by that name.
  const domains = new Map<string, Set<string | null>>()
  for (const c of db.data.prospect_companies ?? []) {
    const key = companyKey(c.name)
    if (!key) continue
    if (!domains.has(key)) domains.set(key, new Set())
    domains.get(key)!.add(c.domain?.replace(/^www\./, '') ?? null)
  }
  const domainOf = (p: PersonResult): string | null => {
    if (p.companyDomain) return p.companyDomain
    const found = p.company ? domains.get(companyKey(p.company)) : undefined
    return found?.size === 1 ? [...found][0] : null
  }
  const rest = people.filter((p) => !skip.has(p.profileUrl))

  if (!opts.includeContacts) {
    const isContact = contactMatcher(db)
    for (const p of rest) {
      if (isContact({ ...p, companyDomain: domainOf(p) })) {
        skip.add(p.profileUrl)
        opts.tally.skippedContact++
        opts.tally.inContacts++
      }
    }
  }

  if (opts.hideUnverifiable) {
    const now = Date.now()
    const worthIt = await formatConfirmedAt(db)
    const unknown: Array<{ p: PersonResult; domain: string }> = []
    for (const p of rest) {
      const domain = domainOf(p)
      if (skip.has(p.profileUrl) || !domain || worthIt(domain)) continue
      const known = (d: string) => db.getEmailDomain(d)
      if (isKnownCatchAll(domain, known, now) || isKnownNoMail(domain, known, now)) {
        skip.add(p.profileUrl)
        opts.tally.skippedUnverifiable++
      } else {
        unknown.push({ p, domain })
      }
    }
    // In a hosted copy, also companies another copy there has found out about.
    const shared = await sharedCatchAll(unknown.map(({ domain }) => ({ ref: null, domain })))
    unknown.forEach(({ p }, i) => {
      if (!shared[i]) return
      skip.add(p.profileUrl)
      opts.tally.skippedUnverifiable++
    })
  }
  return skip
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/**
 * Extra search pages run to fill a page when results are left out (3 credits
 * each): always up to 3, and up to 10 while the page has cost less than a
 * full page normally does, so pages of people skipped for free (contacts,
 * people who couldn't be verified before) can be passed over.
 */
const TOP_UPS = 3
const MAX_TOP_UPS = 10
/**
 * After the first search, top-ups stop if fewer than this share of the people
 * whose profiles were paid for made it onto the page: filters that throw away
 * nearly everyone after the lookup (a narrow company size, say) would
 * otherwise spend a page's worth of credits on nobody.
 */
const MIN_KEPT_SHARE = 0.2
/** …judged once at least this many profiles have been paid for. */
const MIN_LOOKUPS_TO_JUDGE = 10
/** Most people SocialFetch returns for one people-search request. */
const MAX_PER_REQUEST = 50
const MAX_TITLES_SEARCHED = 5

/** What was left out or couldn't be looked up, added up across a page's searches. */
interface Tally {
  noSurname: number
  alreadySaved: number
  /** Left out because they're already contacts (while existing contacts aren't included). */
  inContacts: number
  failed: number
  failedError?: string
  noJob: number
  wrongCompany: number
  /** Left out before their profile lookup: remembered from a lookup that couldn't verify them. */
  remembered: number
  /** Of `inContacts`, those whose profile had been paid for. */
  paidInContacts: number
  /** Left out before their profile lookup, from the search hit (skipBeforeLookup). */
  skippedUnverifiable: number
  skippedNotWorking: number
  skippedContact: number
  /** Companies-first: left out before their profile lookup because their headline names an employer that isn't one of the companies searched. */
  skippedOtherEmployer: number
  /** Taken as working at the company searched, with no profile lookup (knownEmployer). */
  noLookup: number
}

type Source = PeopleSource & Partial<Pick<CompanySource, 'searchCompanies'>>

/* ------------------------------------------------------------- companies first */

/**
 * With a company size chosen, a search finds companies of that size first
 * (SocialFetch filters organizations by staff count itself) and then looks
 * for people inside them, up to MAX_COMPANIES_PER_SEARCH companies a request.
 * Everyone found works somewhere the right size, so no profile is paid for
 * only to be thrown away, and no employer needs sizing. Organization search
 * needs a keyword, hence an industry or keyword is required with a size.
 */
const SIZE_NEEDS_TERM = 'Company size needs an industry or keyword, to find companies of that size first.'

/** Where a companies-first search has got to, carried in its page cursor. */
interface CompanyFirstState {
  /** Which company search (one per industry, or the keyword) is running, and its page. */
  term: number
  orgCursor?: string
  /** Companies found and not yet searched for people. */
  pending: Array<[ref: string, name: string]>
  /** The companies being searched for people now, and that search's cursor. */
  batch: Array<[ref: string, name: string]>
  people?: string
  /** Companies to search one at a time (a batch split up), with each one's cursor. */
  singles?: Array<[ref: string, name: string, people?: string]>
}

/**
 * Searching companies together needs a profile lookup (3 credits) for each
 * person whose headline doesn't say which of them they work at; searching one
 * company needs none, as everyone it returns works there, but costs a search
 * (3 credits a job title, searchesForTitles) per company. Small companies mostly return nobody,
 * so together is cheaper; companies with several people each are cheaper one
 * at a time. A batch whose first page shows more people needing a lookup than
 * one-at-a-time searches would cost is split before any profile is bought.
 * Single-company search requests run at once: companies × job titles.
 */
const SINGLE_REQUESTS_AT_ONCE = 5

const CF_PREFIX = 'cf1.'
const encodeState = (s: CompanyFirstState) => CF_PREFIX + Buffer.from(JSON.stringify(s)).toString('base64url')
function decodeState(cursor: string | undefined): CompanyFirstState {
  if (cursor?.startsWith(CF_PREFIX)) {
    try {
      return JSON.parse(Buffer.from(cursor.slice(CF_PREFIX.length), 'base64url').toString('utf8'))
    } catch {
      // a broken cursor starts again from the top
    }
  }
  return { term: 0, pending: [], batch: [] }
}

/**
 * How long a companies-first search waits for its companies' mail servers to
 * be checked (screenCompanies). Checks still running carry on, and each batch
 * leaves out companies found out about by then (withoutUnverifiable).
 */
const SCREEN_MS = 2_000

/**
 * Companies found by size, without those where no email can be verified,
 * before anyone there is searched for (and their profiles paid for): a
 * domain that takes no email, or a mail server that accepts every address
 * (from the company cache, the host's shared list, or a check from our
 * verification servers). Checks not answered within SCREEN_MS leave the
 * company in, and their answers are kept for later. A company whose email
 * format is confirmed stays in: its guesses are handed over.
 *
 * A company with no domain stays in too, counted as `noDomain`: SocialFetch's
 * company search leaves the website out for most companies (about 3 in 4),
 * which says nothing about whether they have one. Leaving them out (0.9.19)
 * threw away most of every page, and paid for more company searches to
 * refill it.
 */
async function screenCompanies(companies: CompanyResult[], db: Db): Promise<{ keep: CompanyResult[]; unverifiable: number; noDomain: number }> {
  const worthIt = await formatConfirmedAt(db)
  const now = Date.now()
  const known = (d: string) => db.getEmailDomain(d)
  const out: Set<string> = new Set()
  let unverifiable = 0
  let noDomain = 0
  const unknown: Array<{ ref: string; domain: string }> = []
  for (const c of companies) {
    const domain = (c.domain ?? db.getProspectCompany(c.ref)?.domain ?? '').toLowerCase().replace(/^www\./, '')
    if (!domain) {
      noDomain++
    } else if (worthIt(domain)) {
      continue
    } else if (isKnownCatchAll(domain, known, now) || isKnownNoMail(domain, known, now)) {
      out.add(c.ref)
      unverifiable++
    } else {
      unknown.push({ ref: c.ref, domain })
    }
  }
  // In a hosted copy, companies another copy there has found out about.
  const shared = await sharedCatchAll(unknown.map(({ ref, domain }) => ({ ref, domain })))
  const toCheck = unknown.filter((u, i) => {
    if (!shared[i]) return true
    out.add(u.ref)
    unverifiable++
    return false
  })
  if (toCheck.length) {
    const { getFinderDeps } = await import('./runtime')
    const { probeDomain } = await import('./emailFinder')
    const deps = await getFinderDeps()
    const answered = new Map<string, boolean>()
    const checks = Promise.allSettled(
      toCheck.map(async ({ domain }) => {
        const rec = await probeDomain(domain, deps)
        answered.set(domain, rec.accepts_mail === false || rec.catch_all === true)
      }),
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([checks, new Promise((r) => (timer = setTimeout(r, SCREEN_MS)))])
    clearTimeout(timer)
    for (const u of toCheck) {
      if (answered.get(u.domain) && !worthIt(u.domain)) {
        out.add(u.ref)
        unverifiable++
      }
    }
  }
  return { keep: companies.filter((c) => !out.has(c.ref)), unverifiable, noDomain }
}

/**
 * Companies still to be searched, without those a mail-server check has since
 * found take no verifiable email (cache only: the checks screenCompanies
 * started carry on after it stops waiting).
 */
async function withoutUnverifiable(companies: Array<[ref: string, name: string]>, db: Db, screened: { unverifiable: number }): Promise<Array<[string, string]>> {
  const worthIt = await formatConfirmedAt(db)
  const now = Date.now()
  const known = (d: string) => db.getEmailDomain(d)
  const keep = companies.filter(([ref]) => {
    const domain = (db.getProspectCompany(ref)?.domain ?? '').toLowerCase().replace(/^www\./, '')
    return !domain || worthIt(domain) || !(isKnownCatchAll(domain, known, now) || isKnownNoMail(domain, known, now))
  })
  screened.unverifiable += companies.length - keep.length
  return keep
}

/** The company searches to run: one per chosen industry (by name, filtered to it), else the keyword. */
function companyTerms(filters: PeopleFilters): Array<{ keyword: string; industry?: string }> {
  const keyword = filters.keyword?.trim()
  const industries = filters.industries ?? []
  if (industries.length) return industries.map((industry) => ({ keyword: keyword || industry, industry }))
  return keyword ? [{ keyword }] : []
}

/**
 * The next page of people for a companies-first search: searches the next
 * batch of companies, finding more companies when the batch runs out.
 * Returns the page, the companies it covered, and how many company searches
 * it ran.
 */
async function companyFirstPage(
  source: Source,
  db: Db,
  filters: PeopleFilters,
  cursor: string | undefined,
  count: number,
  /** Leave out companies where no email can be verified (screenCompanies), counting them here. */
  screened?: { unverifiable: number; noDomain: number },
): Promise<{
  page: Page<PersonResult>
  companies: Map<string, string>
  orgSearches: number
  found: number
  orgTotal: number | null
  /** Where to carry on if this batch is split up instead (SINGLE_REQUESTS_AT_ONCE): set on a batch's first page. */
  splitCursor: string | null
  /** The batch has more people than this page (so more would need a lookup). */
  batchHasMore: boolean
}> {
  const { canonicalCountry } = await import('./geo')
  const { MAX_COMPANIES_PER_SEARCH } = await import('./socialfetch')
  const terms = companyTerms(filters)
  const wantCountry = canonicalCountry(filters.country)
  let s = decodeState(cursor)
  let orgSearches = 0
  let found = 0
  let orgTotal: number | null = null
  const hasMore = (next: CompanyFirstState) =>
    next.batch.length > 0 || next.pending.length > 0 || Boolean(next.singles?.length) || next.orgCursor !== undefined || next.term < terms.length

  // Companies split from a batch: a few searched at once, each on its own, so
  // everyone found is known to work there and no profile is looked up.
  if (!s.batch.length && s.singles?.length) {
    const now = s.singles.slice(0, Math.max(1, Math.floor(SINGLE_REQUESTS_AT_ONCE / searchesForTitles(filters.titles))))
    const pages = await Promise.all(
      now.map(([ref, name, people]) =>
        source.searchPeople({ ref, name }, { titles: filters.titles, seniorities: filters.seniorities, country: filters.country, count, cursor: people }),
      ),
    )
    const items: PersonResult[] = []
    const funnel = { hits: 0, offTitle: 0, filteredOut: 0 }
    const carryOn: NonNullable<CompanyFirstState['singles']> = []
    pages.forEach((page, i) => {
      const [ref, name] = now[i]
      // Anyone whose headline names another employer was left out by the search.
      for (const p of page.items) items.push({ ...p, company: name, companyRef: ref })
      funnel.hits += page.funnel?.hits ?? page.items.length
      funnel.offTitle += page.funnel?.offTitle ?? 0
      funnel.filteredOut += page.funnel?.filteredOut ?? 0
      if (page.nextCursor) carryOn.push([ref, name, page.nextCursor])
    })
    const next: CompanyFirstState = { ...s, singles: [...carryOn, ...s.singles.slice(now.length)] }
    return {
      page: {
        items,
        nextCursor: hasMore(next) ? encodeState(next) : null,
        reportedTotal: null,
        warnings: [],
        details: [],
        requests: pages.reduce((n, p) => n + (p.requests ?? 1), 0),
        funnel,
      },
      companies: new Map(now.map(([ref, name]) => [ref, name])),
      orgSearches: 0,
      found: 0,
      orgTotal: null,
      splitCursor: null,
      batchHasMore: false,
    }
  }
  // A few company pages at most, in case pages come back with none that fit.
  for (let guard = 0; guard < 4 && !s.batch.length; guard++) {
    if (s.pending.length) {
      const pending = screened ? await withoutUnverifiable(s.pending, db, screened) : s.pending
      s = { ...s, batch: pending.slice(0, MAX_COMPANIES_PER_SEARCH), pending: pending.slice(MAX_COMPANIES_PER_SEARCH), people: undefined }
      if (s.batch.length) break
      continue
    }
    const term = terms[s.term]
    if (!term || !source.searchCompanies) break
    const res = await source.searchCompanies({ keyword: term.keyword, industry: term.industry, headcount: filters.companySizes, country: filters.country, cursor: s.orgCursor })
    // Held companies (from a request that brought more than a page) cost nothing.
    orgSearches += res.requests ?? 1
    if (res.reportedTotal !== null) orgTotal = Math.max(orgTotal ?? 0, res.reportedTotal)
    // Companies are non-personal, so they're cached for everyone (domains for reveals).
    db.upsertProspectCompanies(
      res.items.map((c) => ({ ref: c.ref, name: c.name, domain: c.domain, domain_source: 'socialfetch' as const, headcount: c.headcount, slug: slugFromCompanyUrl(c.linkedinUrl) })),
    )
    // SocialFetch barely narrows companies by country, so their head office is checked here.
    let fits = res.items.filter((c) => /^\d+$/.test(c.ref) && (!wantCountry || !c.country || canonicalCountry(c.country) === wantCountry))
    found += fits.length
    if (screened) {
      const r = await screenCompanies(fits, db)
      fits = r.keep
      screened.unverifiable += r.unverifiable
      screened.noDomain += r.noDomain
    }
    s = {
      ...s,
      pending: fits.map((c) => [c.ref, c.name] as [string, string]),
      orgCursor: res.nextCursor ?? undefined,
      term: res.nextCursor ? s.term : s.term + 1,
    }
  }
  const companies = new Map(s.batch)
  if (!s.batch.length) {
    return { page: { items: [], nextCursor: null, reportedTotal: null, warnings: [], details: [], requests: 0 }, companies, orgSearches, found, orgTotal, splitCursor: null, batchHasMore: false }
  }
  const splitCursor =
    s.batch.length > 1 && !s.people
      ? encodeState({ ...s, batch: [], people: undefined, singles: [...s.batch.map(([ref, name]) => [ref, name] as [string, string]), ...(s.singles ?? [])] })
      : null

  const page = await source.searchPeople(null, {
    titles: filters.titles,
    seniorities: filters.seniorities,
    country: filters.country,
    companyRefs: s.batch.map(([ref]) => ref),
    companyNames: Object.fromEntries(s.batch),
    count,
    cursor: s.people,
  })
  const next: CompanyFirstState = page.nextCursor ? { ...s, people: page.nextCursor } : { ...s, batch: [], people: undefined }
  return {
    page: { ...page, reportedTotal: null, nextCursor: hasMore(next) ? encodeState(next) : null },
    companies,
    orgSearches,
    found,
    orgTotal,
    splitCursor,
    batchHasMore: Boolean(page.nextCursor),
  }
}

/**
 * One search page's people, made ready to show: opted-out people and hidden
 * surnames removed (before anything is paid for), saved contacts filled in
 * from the contact, everyone else's profile looked up for their real title
 * and employer, people who don't work at the chosen company dropped, and
 * known catch-all companies marked.
 */
async function processBatch(
  people: PersonResult[],
  company: { ref: string; name: string } | null,
  source: Source,
  db: Db,
  tally: Tally,
  hideUnverifiable = false,
  includeContacts = false,
  /** Companies-first: the companies this page searched inside (ref → name). */
  companySet?: Map<string, string>,
  /**
   * Companies-first: given how many people need a profile lookup, whether to
   * split the batch up instead (SINGLE_REQUESTS_AT_ONCE). The page then comes back
   * empty, with nothing paid for and nothing counted: its people are found
   * again by the searches of one company.
   */
  splitWhen?: (toLookUp: number) => boolean,
): Promise<{ items: PersonResult[]; refined: string[]; lookupError?: string; lookedUp: string[]; split?: boolean }> {
  const counted = { ...tally }
  let items = people
  for (const person of items) {
    person.companyDomain ??= person.companyRef ? db.getProspectCompany(person.companyRef)?.domain ?? null : null
  }

  // Opted-out people are removed before anything is shown (or paid for),
  // silently — a count would tell the user that someone opted out.
  const suppressed = db.getSuppressionHashes()
  if (suppressed.size > 0) {
    items = items.filter(
      (p) => !isSuppressed(hashesFor({ profileUrl: p.profileUrl, firstName: p.firstName, lastName: p.lastName, domain: p.companyDomain }), suppressed),
    )
  }

  // Someone an earlier lookup here couldn't verify, for a reason a retry
  // won't change (unverifiable.ts), is left out before their profile is paid
  // for again, while unverifiable people are hidden.
  if (hideUnverifiable) {
    const remembered = unverifiableHashes(db)
    if (remembered.size > 0) {
      const keep = items.filter((p) => !remembered.has(profileHash(p.profileUrl) ?? ''))
      tally.remembered += items.length - keep.length
      items = keep
    }
  }

  // A surname shown only as an initial ("Andy C.") means no address can be
  // worked out, so they're left out before any profile lookup is paid for.
  const withSurname = items.filter((p) => !surnameHidden(p.lastName))
  tally.noSurname += items.length - withSurname.length
  items = withSurname

  const saved = markPreviouslySeen(items, db)
  if (includeContacts) {
    tally.alreadySaved += saved
  } else if (saved > 0) {
    // Saved from a search before: known without a profile lookup, so left out for free.
    items = items.filter((p) => p.previously !== 'saved')
    tally.inContacts += saved
  }

  // Inside one company searched by its LinkedIn id, SocialFetch's company
  // filter already says where everyone works (anyone whose headline names
  // another employer was left out), so no profile is paid for to find out:
  // the title comes from the headline, and someone who has since left shows
  // up until a Reveal finds no address for them. In a companies-first search
  // the same goes for anyone whose headline names one of the companies.
  const knownEmployer = (p: PersonResult): { ref: string; name: string } | null => {
    if (p.previously === 'saved' || p.profileChecked) return null
    if (company && /^\d+$/.test(company.ref)) return company
    if (companySet?.size && p.companyRef && companySet.has(p.companyRef)) return { ref: p.companyRef, name: companySet.get(p.companyRef)! }
    if (companySet?.size && p.company) {
      for (const [ref, name] of companySet) if (sameCompanyName(p.company, name)) return { ref, name }
    }
    return null
  }
  const noLookup = new Set<string>()
  items = items.map((p) => {
    const at = knownEmployer(p)
    if (!at) return p
    noLookup.add(p.profileUrl)
    return { ...p, company: at.name, companyRef: at.ref, companyDomain: db.getProspectCompany(at.ref)?.domain ?? null }
  })
  tally.noLookup += noLookup.size

  // In a companies-first search, SocialFetch's company filter also finds
  // people who used to work at one of the companies: someone whose headline
  // names another employer has moved on, so no profile is paid for to find
  // that out (it was most of the profiles paid for in these searches).
  if (companySet?.size) {
    const names = [...companySet.values()]
    const elsewhere = new Set(
      items
        .filter((p) => p.previously !== 'saved' && !p.profileChecked && !noLookup.has(p.profileUrl) && p.company.trim() && !names.some((n) => sameCompanyName(p.company, n)))
        .map((p) => p.profileUrl),
    )
    if (elsewhere.size) {
      tally.skippedOtherEmployer += elsewhere.size
      items = items.filter((p) => !elsewhere.has(p.profileUrl))
    }
  }

  const skipped = await skipBeforeLookup(
    items.filter((p) => p.previously !== 'saved' && !noLookup.has(p.profileUrl)),
    db,
    { hideUnverifiable, includeContacts, tally },
  )
  if (skipped.size) items = items.filter((p) => !skipped.has(p.profileUrl))
  const toLookUp = items.filter((p) => p.previously !== 'saved' && !noLookup.has(p.profileUrl))
  if (toLookUp.length && splitWhen?.(toLookUp.length)) {
    Object.assign(tally, counted)
    return { items: [], refined: [], lookedUp: [], split: true }
  }

  const refined: string[] = []
  let lookupError: string | undefined
  if (toLookUp.length > 0) {
    // Check the first profile before paying for the rest: if the lookup
    // itself fails (no credits, API down) the rest would fail too. A profile
    // that simply lists no company page (freelancers, tiny firms) is normal
    // and doesn't stop the others.
    const first = await enrichOne(toLookUp[0], source, db)
    const results = first.error
      ? [first]
      : [first, ...(await mapLimit(toLookUp.slice(1), ENRICH_CONCURRENCY, (p) => enrichOne(p, source, db)))]
    const byUrl = new Map(results.map((r) => [r.person.profileUrl, r.person]))
    items = items.map((p) => byUrl.get(p.profileUrl) ?? p)
    for (const r of results) if (r.refined) refined.push(r.person.profileUrl)
    if (first.error) {
      lookupError = first.error
    } else {
      const failed = results.filter((r) => r.error)
      tally.failed += failed.length
      tally.failedError ??= failed[0]?.error
      tally.noJob += results.length - refined.length - failed.length
    }
  }

  // Contacts added another way (imported, a form) only show up once their
  // employer is known: the same name at the same company.
  if (!includeContacts && (refined.length > 0 || noLookup.size > 0)) {
    const isContact = contactMatcher(db)
    const fresh = items.filter((p) => !((refined.includes(p.profileUrl) || noLookup.has(p.profileUrl)) && isContact(p)))
    const dropped = items.filter((p) => !fresh.includes(p))
    tally.inContacts += dropped.length
    tally.paidInContacts += dropped.filter((p) => refined.includes(p.profileUrl)).length
    items = fresh
  }

  // With the real employer known, people who don't work at the chosen
  // company can be dropped.
  if (company) {
    const atCompany = items.filter(
      (p) => !refined.includes(p.profileUrl) || p.companyRef === company.ref || sameCompanyName(p.company, company.name),
    )
    tally.wrongCompany += items.length - atCompany.length
    items = atCompany
  } else if (companySet?.size) {
    // Someone who has moved on since LinkedIn indexed them isn't at one of them any more.
    const names = [...companySet.values()]
    const atOne = items.filter(
      (p) => !refined.includes(p.profileUrl) || (p.companyRef && companySet.has(p.companyRef)) || names.some((n) => sameCompanyName(p.company, n)),
    )
    tally.wrongCompany += items.length - atOne.length
    items = atOne
  }

  // Mark people at companies already known to accept every address. The
  // page decides whether to hide them (it does while verified-only is on).
  // Only the cache is read: finding out about a new company would take an
  // SMTP check, and that waits until someone is actually revealed or saved.
  const now = Date.now()
  const worthIt = await formatConfirmedAt(db)
  for (const p of items) {
    if (p.companyDomain && isKnownCatchAll(p.companyDomain, (d) => db.getEmailDomain(d), now)) p.catchAll = !worthIt(p.companyDomain)
    else if (p.companyDomain && isKnownNoMail(p.companyDomain, (d) => db.getEmailDomain(d), now)) p.noMail = true
  }
  // In a hosted copy, also companies any other copy there has found out
  // about (sharedCatchAll.ts): company refs and domains only.
  const unmarked = items.filter((p) => !p.catchAll && !(p.companyDomain && worthIt(p.companyDomain)))
  const shared = await sharedCatchAll(unmarked.map((p) => ({ ref: p.companyRef, domain: p.companyDomain })))
  unmarked.forEach((p, i) => shared[i] && (p.catchAll = true))

  return { items, refined, lookupError, lookedUp: toLookUp.map((p) => p.profileUrl) }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * People search. Search hits don't say where anyone works, and without an
 * employer there's no domain to find an email on, so every result's profile
 * is looked up (3 credits each) for their real current title and company.
 *
 * A page shows as many people as were asked for: when some are left out
 * (hidden surnames, opt-outs, other employers, filters, or — with
 * verified-only on — catch-all companies), up to three more search pages are
 * run to make up the numbers.
 */
export async function searchPeople(
  input: PeopleFilters & { company?: { ref: string; name: string } | null },
  /** Called with each batch's people as soon as they're ready, before the page is done (/api/prospects/search streams them). */
  opts: { onPeople?: (found: { items: PersonResult[]; refined: string[] }) => void } = {},
): Promise<Page<PersonResult> & { refined: string[]; resumed: boolean }> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { hidesUnverifiable, isVerifiedOnly } = await import('./settings')
  const { prospectCredits, remaining, requireAllowance } = await import('../allowance')
  const { company, includeContacts = false, fromStart = false, ...filters } = input
  const source: Source = getSource()
  const companyFirst = !company && Boolean(filters.companySizes?.length)
  if (companyFirst && !companyTerms(filters).length) throw new Error(SIZE_NEEDS_TERM)
  // People whose email can't be verified are hidden, unless the user chose
  // to see them marked as such (Settings → Prospect search).
  const hideUnverifiable = isVerifiedOnly() && hidesUnverifiable()
  const hidden = (p: PersonResult) => hideUnverifiable && Boolean(p.catchAll || p.noMail)
  // A plan's prospect credits: less than one left stops here, before anything is paid for.
  const left = remaining('prospects')
  if (left < 1) requireAllowance('prospects')

  // Results per page apply to each job title, as the search itself does. The
  // page offers them in 25s (PAGE_SIZES): full pages share each search's cost
  // among the most people, which is what a prospect credit is priced on.
  const titles = new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean)).size
  const slots = Math.min(MAX_TITLES_SEARCHED, Math.max(1, titles))
  const perSlot = Math.min(PAGE_SIZES[PAGE_SIZES.length - 1], Math.max(1, filters.count ?? PAGE_SIZES[0]))
  // About one credit per person on a full page, so a page asks for no more than are left.
  const target = Math.min(perSlot * slots, Math.floor(left))
  // Requests the page takes before any top-up: over 50 a title needs two.
  const planned = Math.ceil(Math.ceil(target / slots) / MAX_PER_REQUEST)

  const items: PersonResult[] = []
  const refined: string[] = []
  const seen = new Set<string>()
  const warnings: string[] = []
  const details: string[] = []
  const tally: Tally = {
    noSurname: 0, alreadySaved: 0, inContacts: 0, failed: 0, noJob: 0, wrongCompany: 0, remembered: 0,
    paidInContacts: 0, skippedUnverifiable: 0, skippedNotWorking: 0, skippedContact: 0, skippedOtherEmployer: 0, noLookup: 0,
  }
  // Hidden people don't fill the page.
  const usable = () => items.filter((p) => !hidden(p)).length

  // A new search carries on from where the last one with these filters
  // stopped, so the same first pages aren't paid for and shown again.
  const positionKey = searchPositionKey(input)
  const saved = !filters.cursor && !fromStart ? db.getSearchPosition(positionKey) : null
  let cursor = filters.cursor ?? saved ?? undefined
  let nextCursor: string | null = null
  let reportedTotal: number | null = null
  let searches = 0
  // Paid people-search requests: a page served from held results (searchPool.ts) costs none.
  let requests = 0
  let lookupError: string | undefined
  let lookedUp = 0
  const paidFor = new Set<string>()
  let wasteful = false
  let orgSearches = 0
  let companiesFound = 0
  // Set when the data source failed partway: the page keeps what it had found.
  let interrupted = false
  // Companies left out before searching people there (screenCompanies).
  const screened = { unverifiable: 0, noDomain: 0 }
  // How many companies match the filters in all, as SocialFetch counts them (up to 1,000).
  const org: { total: number | null } = { total: null }
  // What became of the people the searches returned, for the funnel log.
  const funnel = { hits: 0, offTitle: 0, filteredOut: 0, repeats: 0 }
  // Batches searched again one company at a time (SINGLE_REQUESTS_AT_ONCE), and how many companies they held.
  const split = { batches: 0, companies: 0 }
  // One search page (a batch of companies, in a companies-first search), and what finding it took.
  type Fetched = {
    page: Page<PersonResult>
    companySet?: Map<string, string>
    splitCursor: string | null
    batchHasMore: boolean
    orgSearches: number
    found: number
    orgTotal: number | null
    screened: { unverifiable: number; noDomain: number }
  }
  const fetchPage = async (at: string | undefined, count: number): Promise<Fetched> => {
    const sc = { unverifiable: 0, noDomain: 0 }
    if (!companyFirst) {
      const page = await source.searchPeople(company ?? null, { ...filters, cursor: at, count })
      return { page, splitCursor: null, batchHasMore: false, orgSearches: 0, found: 0, orgTotal: null, screened: sc }
    }
    const r = await companyFirstPage(source, db, filters, at, count, hideUnverifiable ? sc : undefined)
    return { page: r.page, companySet: r.companies, splitCursor: r.splitCursor, batchHasMore: r.batchHasMore, orgSearches: r.orgSearches, found: r.found, orgTotal: r.orgTotal, screened: sc }
  }
  // The next search page, started while this one's profiles are looked up
  // (only when the page certainly needs it), and any started but not used:
  // their credits are counted before the search ends, and their people are
  // held (searchPool.ts) for Load more.
  let ahead: { cursor: string; fetched: Promise<Fetched> } | null = null
  const unused: Promise<unknown>[] = []
  const dropAhead = () => {
    if (!ahead) return
    unused.push(ahead.fetched.then((r) => ((requests += r.page.requests ?? 1), (orgSearches += r.orgSearches)), () => {}))
    ahead = null
  }
  // What a full page normally costs: its searches and a profile lookup per person.
  const pageBudget = planned * 3 + target * 3
  const { credits } = await meterCredits(async (spent) => {
    for (;;) {
      const need = target - usable()
      const count = Math.min(MAX_PER_REQUEST, Math.max(1, Math.ceil(need / slots)))
      let r: Fetched
      try {
        if (ahead && ahead.cursor === cursor) {
          const { fetched } = ahead
          ahead = null
          r = await fetched
        } else {
          dropAhead()
          r = await fetchPage(cursor, count)
        }
      } catch (err) {
        // SocialFetch failed partway (busy or down, after its own retries):
        // keep the people found so far and what they cost, rather than
        // failing the search. Load more carries on from the same place. With
        // nobody found yet it fails as before, and costs the customer nothing.
        dropAhead()
        await Promise.allSettled(unused)
        if (items.length === 0) throw err
        console.warn(`[Prospecting] Search stopped partway: ${(err as Error)?.message ?? err}`)
        interrupted = true
        break
      }
      const { page, companySet, splitCursor } = r
      let splitWhen: ((toLookUp: number) => boolean) | undefined
      if (splitCursor) {
        // A batch with more people than this page is likely to need more lookups than it shows.
        const batchSize = r.companySet?.size ?? 0
        const more = r.batchHasMore
        splitWhen = (toLookUp) => toLookUp * (more ? 2 : 1) > batchSize * searchesForTitles(filters.titles)
      }
      orgSearches += r.orgSearches
      companiesFound += r.found
      screened.unverifiable += r.screened.unverifiable
      screened.noDomain += r.screened.noDomain
      if (r.orgTotal !== null) org.total = Math.max(org.total ?? 0, r.orgTotal)
      searches++
      requests += page.requests ?? 1
      // The first search's notes describe the whole query; later top-ups would repeat them.
      if (searches === 1) {
        reportedTotal = page.reportedTotal
        warnings.push(...page.warnings)
        details.push(...(page.details ?? []))
      }
      nextCursor = page.nextCursor
      const fresh = page.items.filter((p) => !seen.has(p.profileUrl))

      // Even with everyone here shown the page won't be full, so the next
      // search page starts now rather than after these profiles are looked up.
      const certain =
        nextCursor &&
        usable() + fresh.length < target &&
        searches < planned + MAX_TOP_UPS &&
        !(searches >= planned + TOP_UPS && spent() >= pageBudget) &&
        prospectCredits(spent()) < left
      if (certain) {
        // Sized for what's still needed if everyone here is shown.
        const fetched = fetchPage(nextCursor!, Math.min(MAX_PER_REQUEST, Math.max(1, Math.ceil((need - fresh.length) / slots))))
        fetched.catch(() => {})
        ahead = { cursor: nextCursor!, fetched }
      }

      const batch = await processBatch(fresh, company ?? null, source, db, tally, hideUnverifiable, includeContacts, companySet, splitWhen)
      if (batch.split && splitCursor) {
        // Searched again one company at a time: its people come back from those searches.
        split.batches++
        split.companies += companySet?.size ?? 0
        nextCursor = splitCursor
        cursor = splitCursor
        continue
      }
      funnel.hits += page.funnel?.hits ?? page.items.length
      funnel.offTitle += page.funnel?.offTitle ?? 0
      funnel.filteredOut += page.funnel?.filteredOut ?? 0
      funnel.repeats += page.items.length - fresh.length
      fresh.forEach((p) => seen.add(p.profileUrl))
      items.push(...batch.items)
      refined.push(...batch.refined)
      if (batch.items.length) opts.onPeople?.({ items: batch.items, refined: batch.refined })
      lookedUp += batch.lookedUp.length
      batch.lookedUp.forEach((url) => paidFor.add(url))
      if (batch.lookupError) {
        lookupError = batch.lookupError
        break
      }
      if (usable() >= target || !nextCursor || searches >= planned + MAX_TOP_UPS) break
      if (searches >= planned && lookedUp >= MIN_LOOKUPS_TO_JUDGE && usable() / lookedUp < MIN_KEPT_SHARE) {
        wasteful = true
        break
      }
      if (searches >= planned + TOP_UPS && spent() >= pageBudget) break
      // No top-up search once what's been spent uses up the credits left.
      if (prospectCredits(spent()) >= left) break
      cursor = nextCursor
    }
    dropAhead()
    await Promise.allSettled(unused)
  })

  // Where to carry on next time; at the end of the results, back to the top.
  if (!lookupError) db.setSearchPosition(positionKey, nextCursor)

  // One line per search: where the people it returned went. Filters and counts only, nothing personal.
  console.log(
    `[Prospecting] Search funnel ${JSON.stringify({
      filters: {
        titles: filters.titles,
        seniorities: filters.seniorities,
        industries: filters.industries,
        sizes: filters.companySizes,
        country: filters.country,
        keyword: filters.keyword || undefined,
        company: company?.name,
        page: filters.cursor ? 'more' : saved ? 'resumed' : 'first',
      },
      companiesFirst: companyFirst,
      orgSearches,
      companiesFound,
      companiesInAll: org.total,
      companiesLeftOut: screened.unverifiable,
      batchesSplit: split.batches,
      companiesSearchedAlone: split.companies,
      peopleSearches: requests,
      hits: funnel.hits,
      offTitle: funnel.offTitle,
      seniorityOrCountry: funnel.filteredOut,
      repeats: funnel.repeats,
      headlineLeft: tally.skippedNotWorking,
      headlineOtherEmployer: tally.skippedOtherEmployer,
      inContacts: tally.inContacts,
      noSurname: tally.noSurname,
      knownUnverifiable: tally.skippedUnverifiable,
      noLookupNeeded: tally.noLookup,
      profilesBought: lookedUp,
      boughtWrongCompany: tally.wrongCompany,
      boughtNoJob: tally.noJob,
      hiddenUnverifiable: items.filter(hidden).length,
      shown: usable(),
      prospectCredits: Math.round(prospectCredits(credits) * 100) / 100,
    })}`,
  )

  // Charged for what the searches cost, not for how many people are shown.
  const { recordUsage } = await import('../usage')
  recordUsage({
    searches: requests + orgSearches,
    prospects: usable(),
    prospectCredits: prospectCredits(credits),
    searchProfiles: lookedUp,
    searchPaidWrongCompany: tally.wrongCompany,
    searchPaidInContacts: tally.paidInContacts,
    searchPaidUnverifiable: items.filter((p) => hidden(p) && paidFor.has(p.profileUrl)).length,
    searchSkippedUnverifiable: tally.skippedUnverifiable,
    searchSkippedContact: tally.skippedContact,
    searchSkippedNotWorking: tally.skippedNotWorking,
    searchSkippedOtherEmployer: tally.skippedOtherEmployer,
    searchNoLookup: tally.noLookup,
    searchOrgRequests: orgSearches,
    searchCompaniesFound: companiesFound,
    searchCompaniesUnverifiable: screened.unverifiable,
    searchCompaniesNoDomain: screened.noDomain,
  })
  if (companyFirst && companiesFound) {
    details.push(`Found ${plural(companiesFound, 'company', 'companies')} of the chosen size first, then looked for people there.`)
  }
  if (split.companies) {
    details.push(
      `Searched ${plural(split.companies, 'company', 'companies')} one at a time: most people found there needed a profile lookup to tell which company they work at, and a search of one company needs none.`,
    )
  }
  if (screened.unverifiable) {
    details.push(
      `Left out ${plural(screened.unverifiable, 'company whose mail server accepts every address or takes no email', 'companies whose mail servers accept every address or take no email')}, where no email can be verified, before searching for people there.`,
    )
  }

  if (lookupError) details.push(`Couldn't look up profiles (${lookupError}), so titles and companies come from headlines.`)
  if (tally.noSurname > 0) {
    details.push(
      `${plural(tally.noSurname, 'person was', 'people were')} left out because LinkedIn hides ${tally.noSurname === 1 ? 'their surname' : 'their surnames'} (e.g. "Andy C."), so no email can be found.`,
    )
  }
  if (tally.failed > 0) details.push(`${plural(tally.failed, 'profile lookup', 'profile lookups')} failed (${tally.failedError}); showing the headline instead.`)
  if (tally.noJob > 0) details.push(`${plural(tally.noJob, 'profile has', 'profiles have')} no current job listed; showing the headline instead.`)
  if (tally.remembered > 0) {
    details.push(`${plural(tally.remembered, 'person was', 'people were')} left out because an earlier lookup couldn't verify ${tally.remembered === 1 ? 'their email' : 'their emails'}, and no profile lookup was paid for.`)
  }
  if (tally.skippedNotWorking > 0) {
    details.push(
      `${plural(tally.skippedNotWorking, 'person was', 'people were')} left out because ${tally.skippedNotWorking === 1 ? 'their headline says they have' : 'their headlines say they have'} left their job (e.g. "Former …"), and no profile lookup was paid for.`,
    )
  }
  if (tally.skippedOtherEmployer > 0) {
    details.push(
      `${plural(tally.skippedOtherEmployer, 'person was', 'people were')} left out because ${tally.skippedOtherEmployer === 1 ? 'their headline names' : 'their headlines name'} an employer that isn't one of these companies (they've moved on), and no profile lookup was paid for.`,
    )
  }
  if (tally.skippedUnverifiable > 0) {
    details.push(
      `${plural(tally.skippedUnverifiable, 'person was', 'people were')} left out because ${tally.skippedUnverifiable === 1 ? 'their headline names a company' : 'their headlines name companies'} where no email can be verified, and no profile lookup was paid for.`,
    )
  }
  if (tally.noLookup > 0 && company) {
    details.push(`LinkedIn's company filter says these people work at ${company.name}, so their titles come from their headlines and no profiles were paid for.`)
  }
  if (tally.inContacts > 0) {
    details.push(
      `${plural(tally.inContacts, 'person was', 'people were')} left out because they're already in your contacts. Turn on "Include existing contacts" to see them.`,
    )
  }
  if (tally.alreadySaved > 0) {
    details.push(`${plural(tally.alreadySaved, 'person is', 'people are')} already in your contacts, so their details come from there and no profile lookup was paid for.`)
  }
  if (company && tally.wrongCompany > 0) {
    details.push(`${plural(tally.wrongCompany, "person doesn't", "people don't")} currently work at ${company.name} and ${tally.wrongCompany === 1 ? 'was' : 'were'} left out.`)
  }

  if (requests > planned) {
    details.push(`Some results were left out, so ${plural(requests - planned, 'more search page was', 'more search pages were')} run to fill this page (3 credits each).`)
  }
  if (target < perSlot * slots) {
    warnings.push(`Your plan has ${plural(Math.floor(left), 'prospect credit', 'prospect credits')} left this month, so this page asks for at most about that many people. Upgrade to get more.`)
  }
  if (wasteful) warnings.push(wastefulWarning(tally, items.length - usable(), lookedUp, company?.name))
  if (interrupted) {
    // A warning: a hosted copy shows it too, as it says what to do.
    warnings.push(`The people data source is busy right now, so this page stopped at ${usable()} of the ${target} asked for. Load more in a minute to carry on.`)
  } else if (!lookupError && usable() < target && nextCursor && !wasteful) {
    details.push(`Found ${usable()} of ${target} after ${plural(searches, 'search', 'searches')}. Load more to keep looking.`)
  } else if (!lookupError && usable() < target && companyFirst && !nextCursor && !wasteful) {
    // The companies ran out: a small market, not a broken search. Say how small, and what widens it.
    const size = org.total !== null && org.total < 1000 ? `${org.total.toLocaleString('en-GB')} ${org.total === 1 ? 'company matches' : 'companies match'}` : 'Every company matching'
    const what = [filters.industries?.length ? filters.industries.join(', ') : null, filters.companySizes?.length ? `${filters.companySizes.join(', ')} staff` : null, filters.country || null]
      .filter(Boolean)
      .join(', ')
    warnings.push(
      `That's everyone at these companies: ${usable()} of the ${target} asked for. ${size} ${what ? `(${what}) ` : ''}in the data, and ${org.total !== null && org.total < 1000 ? 'all of them have' : 'they have all'} now been searched${saved ? ' (with your earlier searches)' : ''}. A wider industry, more company sizes or more job titles (Founders and owners adds Owner, CEO, Managing Director and President) will find more.`,
    )
  } else if (!lookupError && usable() < target) {
    // A warning, not a detail: a hosted copy shows it too, as it says what to do.
    warnings.push(`That's everyone this search found: ${usable()} of the ${target} asked for. Broader job titles or fewer filters will find more.`)
  }

  return { ...forThisCopy({ items, nextCursor, reportedTotal, warnings, details }), refined, resumed: Boolean(saved) }
}

/** Why a search stopped early: the filter that threw away most of the people paid for, and what to try. */
function wastefulWarning(tally: Tally, hidden: number, lookedUp: number, companyName?: string): string {
  const reasons: Array<[number, string, string]> = [
    [tally.wrongCompany, companyName ? `Working somewhere other than ${companyName}` : 'Their current employer', 'Try other job titles.'],
    [hidden, "Emails that can't be verified", 'Settings → Prospect search can show these people, marked as unverifiable.'],
  ]
  const [n, why, next] = reasons.sort((a, b) => b[0] - a[0])[0]
  const left = n > 0 ? `${why} left out ${n} of the ${lookedUp} people whose profiles were checked` : `Most of the ${lookedUp} people whose profiles were checked were left out`
  return `${left}, so no more pages were searched, to save credits. ${n > 0 ? next : 'Try broader filters.'} Load more carries on if you want to keep looking.`
}

/** The same filters give the same key, whatever order titles or options were picked in. */
function searchPositionKey(input: PeopleFilters & { company?: { ref: string; name: string } | null }): string {
  const sorted = (xs?: string[]) => [...(xs ?? [])].map((x) => x.trim().toLowerCase()).filter(Boolean).sort()
  const key = JSON.stringify({
    company: input.company?.ref ?? null,
    titles: sorted(input.titles),
    seniorities: sorted(input.seniorities),
    country: input.country?.trim().toLowerCase() || null,
    keyword: input.keyword?.trim().toLowerCase() || null,
    industries: sorted(input.industries),
    sizes: input.company ? [] : sorted(input.companySizes),
    includeContacts: Boolean(input.includeContacts),
  })
  return createHash('sha256').update(key).digest('base64url').slice(0, 32)
}

export async function startSave(listId: number, people: PersonResult[]) {
  const { db } = await import('../db')
  if (!db.data.lists.some((l) => l.id === listId)) throw new Error(`List ${listId} does not exist`)
  const { getSource, getFinderDeps } = await import('./runtime')
  const { saveProspects } = await import('./save')
  const { allowsFormatConfirmed, isVerifiedOnly } = await import('./settings')
  const { contribute } = await import('./sharedPeople')
  return saveProspects(listId, people, {
    source: getSource(),
    finder: await getFinderDeps({ background: true }),
    db,
    verifiedOnly: isVerifiedOnly(),
    allowFormatConfirmed: allowsFormatConfirmed(),
    contribute,
  })
}
