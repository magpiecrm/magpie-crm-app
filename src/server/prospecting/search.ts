// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import { createHash } from 'node:crypto'
import { env } from '../env'
import { refineFromProfile } from './refine'
import { PAGE_SIZES, type CompanyFilters, type CompanyResult, type CompanySource, type Page, type PeopleFilters, type PeopleSource, type PersonResult } from './types'
import { hasConfirmedFormat, isKnownCatchAll, isKnownNoMail, surnameHidden } from './emailFinder'
import { unverifiableHashes } from './unverifiable'
import { sharedCatchAll } from './sharedCatchAll'
import { companyKey, meterCredits, sameCompanyName, slugFromCompanyUrl } from './socialfetch'
import { classifySeniority } from './seniority'
import { emailHash, hashesFor, isSuppressed, profileHash } from './suppression'

export async function searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { prospectCredits, remaining, requireAllowance } = await import('../allowance')
  // Browsing companies is searching too: it uses search credits for what it costs.
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

const ENRICH_CONCURRENCY = 3

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
}

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
): Promise<{ page: Page<PersonResult>; companies: Map<string, string>; orgSearches: number; found: number }> {
  const { canonicalCountry } = await import('./geo')
  const { MAX_COMPANIES_PER_SEARCH } = await import('./socialfetch')
  const terms = companyTerms(filters)
  const wantCountry = canonicalCountry(filters.country)
  let s = decodeState(cursor)
  let orgSearches = 0
  let found = 0
  // A few company pages at most, in case pages come back with none that fit.
  for (let guard = 0; guard < 4 && !s.batch.length; guard++) {
    if (s.pending.length) {
      s = { ...s, batch: s.pending.slice(0, MAX_COMPANIES_PER_SEARCH), pending: s.pending.slice(MAX_COMPANIES_PER_SEARCH), people: undefined }
      break
    }
    const term = terms[s.term]
    if (!term || !source.searchCompanies) break
    const res = await source.searchCompanies({ keyword: term.keyword, industry: term.industry, headcount: filters.companySizes, country: filters.country, cursor: s.orgCursor })
    orgSearches++
    // Companies are non-personal, so they're cached for everyone (domains for reveals).
    db.upsertProspectCompanies(
      res.items.map((c) => ({ ref: c.ref, name: c.name, domain: c.domain, domain_source: 'socialfetch' as const, headcount: c.headcount, slug: slugFromCompanyUrl(c.linkedinUrl) })),
    )
    // SocialFetch barely narrows companies by country, so their head office is checked here.
    const fits = res.items.filter((c) => /^\d+$/.test(c.ref) && (!wantCountry || !c.country || canonicalCountry(c.country) === wantCountry))
    found += fits.length
    s = {
      ...s,
      pending: fits.map((c) => [c.ref, c.name] as [string, string]),
      orgCursor: res.nextCursor ?? undefined,
      term: res.nextCursor ? s.term : s.term + 1,
    }
  }
  const companies = new Map(s.batch)
  if (!s.batch.length) return { page: { items: [], nextCursor: null, reportedTotal: null, warnings: [], details: [] }, companies, orgSearches, found }

  const page = await source.searchPeople(null, {
    titles: filters.titles,
    seniorities: filters.seniorities,
    country: filters.country,
    companyRefs: s.batch.map(([ref]) => ref),
    count,
    cursor: s.people,
  })
  const next: CompanyFirstState = page.nextCursor ? { ...s, people: page.nextCursor } : { ...s, batch: [], people: undefined }
  const more = next.batch.length > 0 || next.pending.length > 0 || next.orgCursor !== undefined || next.term < terms.length
  return { page: { ...page, reportedTotal: null, nextCursor: more ? encodeState(next) : null }, companies, orgSearches, found }
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
): Promise<{ items: PersonResult[]; refined: string[]; lookupError?: string; lookedUp: string[] }> {
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

  const skipped = await skipBeforeLookup(
    items.filter((p) => p.previously !== 'saved' && !noLookup.has(p.profileUrl)),
    db,
    { hideUnverifiable, includeContacts, tally },
  )
  if (skipped.size) items = items.filter((p) => !skipped.has(p.profileUrl))
  const toLookUp = items.filter((p) => p.previously !== 'saved' && !noLookup.has(p.profileUrl))

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
  // A plan's search credits: less than one left stops here, before anything is paid for.
  const left = remaining('prospects')
  if (left < 1) requireAllowance('prospects')

  // Results per page apply to each job title, as the search itself does. The
  // page offers them in 25s (PAGE_SIZES): full pages share each search's cost
  // among the most people, which is what a search credit is priced on.
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
    paidInContacts: 0, skippedUnverifiable: 0, skippedNotWorking: 0, skippedContact: 0, noLookup: 0,
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
  let lookupError: string | undefined
  let lookedUp = 0
  const paidFor = new Set<string>()
  let wasteful = false
  let orgSearches = 0
  let companiesFound = 0
  const { credits } = await meterCredits(async (spent) => {
    for (;;) {
      const need = target - usable()
      const count = Math.min(MAX_PER_REQUEST, Math.max(1, Math.ceil(need / slots)))
      let page: Page<PersonResult>
      let companySet: Map<string, string> | undefined
      if (companyFirst) {
        const r = await companyFirstPage(source, db, filters, cursor, count)
        page = r.page
        companySet = r.companies
        orgSearches += r.orgSearches
        companiesFound += r.found
      } else {
        page = await source.searchPeople(company ?? null, { ...filters, cursor, count })
      }
      searches++
      // The first search's notes describe the whole query; later top-ups would repeat them.
      if (searches === 1) {
        reportedTotal = page.reportedTotal
        warnings.push(...page.warnings)
        details.push(...(page.details ?? []))
      }
      nextCursor = page.nextCursor
      const fresh = page.items.filter((p) => !seen.has(p.profileUrl))
      fresh.forEach((p) => seen.add(p.profileUrl))

      const batch = await processBatch(fresh, company ?? null, source, db, tally, hideUnverifiable, includeContacts, companySet)
      items.push(...batch.items)
      refined.push(...batch.refined)
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
      // What a full page normally costs: its searches and a profile lookup per person.
      const pageBudget = planned * 3 + target * 3
      if (searches >= planned + TOP_UPS && spent() >= pageBudget) break
      // No top-up search once what's been spent uses up the credits left.
      if (prospectCredits(spent()) >= left) break
      cursor = nextCursor
    }
  })

  // Where to carry on next time; at the end of the results, back to the top.
  if (!lookupError) db.setSearchPosition(positionKey, nextCursor)

  // Charged for what the searches cost, not for how many people are shown.
  const { recordUsage } = await import('../usage')
  recordUsage({
    searches: searches + orgSearches,
    prospects: usable(),
    prospectCredits: prospectCredits(credits),
    searchProfiles: lookedUp,
    searchPaidWrongCompany: tally.wrongCompany,
    searchPaidInContacts: tally.paidInContacts,
    searchPaidUnverifiable: items.filter((p) => hidden(p) && paidFor.has(p.profileUrl)).length,
    searchSkippedUnverifiable: tally.skippedUnverifiable,
    searchSkippedContact: tally.skippedContact,
    searchSkippedNotWorking: tally.skippedNotWorking,
    searchNoLookup: tally.noLookup,
  })
  if (companyFirst && companiesFound) {
    details.push(`Found ${plural(companiesFound, 'company', 'companies')} of the chosen size first, then looked for people there.`)
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

  if (searches > planned) {
    details.push(`Some results were left out, so ${plural(searches - planned, 'more search page was', 'more search pages were')} run to fill this page (3 credits each).`)
  }
  if (target < perSlot * slots) {
    warnings.push(`Your plan has ${plural(Math.floor(left), 'search credit', 'search credits')} left this month, so this page asks for at most about that many people. Upgrade to get more.`)
  }
  if (wasteful) warnings.push(wastefulWarning(tally, items.length - usable(), lookedUp, company?.name))
  if (!lookupError && usable() < target && nextCursor && !wasteful) {
    details.push(`Found ${usable()} of ${target} after ${plural(searches, 'search', 'searches')}. Load more to keep looking.`)
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
  return saveProspects(listId, people, {
    source: getSource(),
    finder: await getFinderDeps({ background: true }),
    db,
    verifiedOnly: isVerifiedOnly(),
    allowFormatConfirmed: allowsFormatConfirmed(),
  })
}
