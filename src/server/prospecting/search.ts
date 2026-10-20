// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import { createHash } from 'node:crypto'
import { env } from '../env'
import { refineFromProfile } from './refine'
import { bucketOf, PAGE_SIZES, ProfileUnconfirmed, type CompanyFilters, type CompanyResult, type CompanySource, type Page, type PeopleFilters, type PeopleSource, type PersonResult, type Signal, type SignalKind } from './types'
import { hasSignal, newInRoleSignal, signalKey, withSignals } from './signals'
import { companySignals, WEB_SIGNAL_KINDS, type WebSignalKind } from './companySignals'
import { warmFor, warmIndex, warmSignal, warmTargets, warmWithoutRef } from './warmAccounts'
import { hasConfirmedFormat, isKnownCatchAll, isKnownNoMail, isKnownSilent, surnameHidden, trustedPattern } from './emailFinder'
import { FINDER_VERSION, unverifiableEntries } from './unverifiable'
import { guessesChangedFor } from './patterns'
import { sharedCatchAll, sharedCatchAllVerdicts, type SharedVerdict } from './sharedCatchAll'
import { noTitleBatches } from './hostRules'
import { companyNamer, companyPageReader, companyWebsite, findCompanyByName, isCompanyName, plainlySameCompany } from './companies'
import { findCompanySite, knownToHaveNoSite } from './companySite'
import { isPlatformDomain } from './platformDomains'
import { webSearcher } from './webSearch'
import { knownPeople } from './sharedPeople'
import { logSearch, newSearchId } from './searchLog'
import { companyKey, cursorIsNoTitle, fitsTitles, inHeadcountBuckets, meterCredits, onlySmallCompanies, sameCompanyName, searchesForTitles, slugFromCompanyUrl } from './socialfetch'
import { classifySeniority } from './seniority'
import { emailHash, hashesFor, isSuppressed, profileHash } from './suppression'

export async function searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { remaining, requireAllowance } = await import('../allowance')
  // Browsing companies is free, but not once the plan's prospects are used up.
  if (remaining('prospects') < 1) requireAllowance('prospects')
  const page = await getSource().searchCompanies(filters)

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
  // Companies where the workspace's own email, forms or proposals found interest lately (warmAccounts.ts).
  const warm = warmIndex(db.data)
  for (const company of page.items) {
    const signal = warmFor(warm, { domain: company.domain, ref: company.ref })
    if (signal) company.signals = [signal]
  }

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
/** What one profile lookup costs, in SocialFetch credits. */
/**
 * How lately the host's shared database must have verified someone's email
 * for it to say where they work when their headline doesn't.
 */
const SHARED_FRESH_MS = 90 * 24 * 60 * 60_000

type Db = typeof import('../db')['db']
/** Where someone works, as far as matching it to a company goes: the name, and the company page if there is one. */
type Employer = Pick<PersonResult, 'company' | 'companyRef' | 'companySlug'>

interface Enriched {
  person: PersonResult
  refined: boolean
  /** The lookup itself failed (e.g. out of credits); nothing was learned. */
  error?: string
  /** The profile couldn't be read (ProfileUnconfirmed): nothing learned, nothing charged. */
  unconfirmed?: boolean
}

/**
 * One profile lookup (3 credits): the person's real current title and
 * employer. `searched`: whether an employer is one the search is for, which
 * decides the job shown for someone who holds several.
 */
async function enrichOne(
  person: PersonResult,
  source: PeopleSource,
  db: Db,
  searched?: (job: Employer) => boolean,
  /** Whether a job title is one searched for, and a count of which job was taken (refineFromProfile). */
  opts: { titleFits?: (title: string) => boolean; noted?: (how: 'other' | 'refused') => void } = {},
): Promise<Enriched> {
  let profile: PersonResult | null
  try {
    profile = await source.getPerson(person.profileUrl)
  } catch (err: any) {
    if (err instanceof ProfileUnconfirmed) return { person, refined: false, unconfirmed: true }
    // Keep the search result rather than failing the whole page the user
    // already paid for; not marked checked, so saving can try again.
    return { person, refined: false, error: String(err?.message ?? err) }
  }
  const refined = refineFromProfile(person, profile, searched, opts)
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
      if (knownDeadEnd(domain, known, now)) {
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

/**
 * How long a batch of people waits, once everything else about it is known,
 * for the tests of their companies' mail domains to finish before it's
 * shown. The tests start as each company's website is learned, so most of
 * their time runs alongside the rest of the batch's work. One still waiting
 * its turn after this carries on, and is known about by the next batch, the
 * next search or a Reveal.
 */
const AHEAD_MS = 20_000

/**
 * Tests of mail domains nobody has looked an email up at yet, made while a
 * batch of people is put together: whether each takes email (DNS, free) and
 * whether it accepts every address (a check or two from the verification
 * servers, the same ones a first Reveal there would make, so a Reveal that
 * follows doesn't repeat them). People at a domain where nothing can be
 * verified are then hidden before anyone spends a credit on them. The checks
 * use only what's spare of the verification allowance (getFinderDeps
 * `ahead`).
 */
function domainTests() {
  const started = new Map<string, Promise<void>>()
  const answered = new Set<string>()
  let tools: Promise<{ deps: Awaited<ReturnType<typeof import('./runtime')['getFinderDeps']>>; probeDomain: typeof import('./emailFinder')['probeDomain'] }> | null = null
  const load = () =>
    (tools ??= (async () => {
      const { getFinderDeps } = await import('./runtime')
      const { probeDomain } = await import('./emailFinder')
      return { deps: await getFinderDeps({ ahead: true }), probeDomain }
    })())
  const key = (domain: string) => domain.toLowerCase().trim()
  return {
    /** Starts testing a domain, without waiting for the answer. */
    start(domain: string) {
      const d = key(domain)
      if (!d || started.has(d)) return
      started.set(
        d,
        (async () => {
          const { deps, probeDomain } = await load()
          await probeDomain(d, deps)
          answered.add(d)
        })().catch(() => {}),
      )
    },
    /** Waits up to AHEAD_MS for these domains' tests, starting any not begun: how many were answered in time. */
    async settle(domains: string[]): Promise<number> {
      const wanted = [...new Set(domains.map(key))].filter(Boolean)
      if (!wanted.length) return 0
      wanted.forEach((d) => this.start(d))
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([Promise.all(wanted.map((d) => started.get(d))), new Promise((r) => (timer = setTimeout(r, AHEAD_MS)))])
      clearTimeout(timer)
      return wanted.filter((d) => answered.has(d)).length
    },
  }
}

/**
 * Whether earlier checks say no address can be verified at a mail domain:
 * it accepts every address, takes no email, or its mail server wouldn't
 * answer our test and isn't due another try yet. Cache only.
 */
const knownDeadEnd = (domain: string, known: (d: string) => ReturnType<Db['getEmailDomain']>, now: number) =>
  isKnownCatchAll(domain, known, now) || isKnownNoMail(domain, known, now) || isKnownSilent(domain, known, now)

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
 * otherwise spend a page's worth of credits on nobody. Not where the host's
 * lookups cost nothing (profileLookupsFree): there it only stopped a search
 * after its first batch of companies, with a thousand more to look through,
 * so the page's own budget and MAX_TOP_UPS end it instead.
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
  /** Left out because their profile couldn't be confirmed (ProfileUnconfirmed), after a second try. */
  unconfirmed: number
  wrongCompany: number
  /** Left out before their profile lookup: remembered from a lookup that couldn't verify them. */
  remembered: number
  /** Of `inContacts`, those whose profile had been paid for. */
  paidInContacts: number
  /** Left out before their profile lookup, from the search hit (skipBeforeLookup). */
  skippedUnverifiable: number
  /** Taken to work at the one company we know by their employer's name, which their profile didn't link. */
  employerByName: number
  /** Placed at the company whose page their employer's name would have, once that page's name matched (findCompanyByName). */
  employerByGuess: number
  /** Given the website a web search found for their employer, which has no LinkedIn page (companySite.ts). */
  employerBySite: number
  /** Marked as having no company to find a website for (PersonResult.noCompany). */
  noCompany: number
  /** Mail domains tested before their people were shown (checkDomainsAhead), and those there was no time or allowance for. */
  domainsChecked: number
  domainsUnchecked: number
  /** Company pages read for their website before their people were shown, and people marked because there was none to be found. */
  companyPagesRead: number
  noWebsite: number
  skippedNotWorking: number
  skippedContact: number
  /** Companies-first: left out before their profile lookup because their headline names an employer that isn't one of the companies searched. */
  skippedOtherEmployer: number
  /** Taken as working at the company searched, with no profile lookup (knownEmployer). */
  noLookup: number
  /**
   * Found by web search (webSource.ts), whose result named their employer, and kept with it: their
   * profile couldn't be read, or lookups cost credits and the result said enough.
   */
  employerFromListing: number
  /** Signals filter (signals.ts): left out for having none of the signals asked for. */
  noSignal: number
  /** Profiles whose job at a company searched wasn't their first: taken (its title fits, or their headline names it), or refused. */
  otherJob: number
  otherJobRefused: number
  /** Profiles that said when the job shown started: to the month, or only the year. */
  roleStartMonth: number
  roleStartYear: number
  /** Left out as working elsewhere, though their employer's page name is that of a company searched (counts whether matching pages by name is worth doing). */
  wrongCompanySameSlug: number
  /** Left out because their employer's website couldn't be looked for (a web search or page read that failed twice), not because it has none. */
  siteLookupFailed: number
}

type Source = PeopleSource & Partial<Pick<CompanySource, 'searchCompanies' | 'getCompany'>>

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
  /** The Warm filter: the workspace's warm companies have been queued (warmAccounts.ts), instead of searching for companies. */
  warm?: boolean
  /** Hiring and funding filters: companies put back once to wait for their signals (screenBySignals). */
  waited?: string[]
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
async function screenCompanies(companies: CompanyResult[], db: Db): Promise<{ keep: CompanyResult[]; unverifiable: number; noDomain: number; noWebsite: number }> {
  const worthIt = await formatConfirmedAt(db)
  const now = Date.now()
  const known = (d: string) => db.getEmailDomain(d)
  const canSearchWeb = Boolean(webSearcher())
  const out: Set<string> = new Set()
  let unverifiable = 0
  let noDomain = 0
  let noWebsite = 0
  const unknown: Array<{ ref: string; domain: string }> = []
  for (const c of companies) {
    const domain = (c.domain ?? db.getProspectCompany(c.ref)?.domain ?? '').toLowerCase().replace(/^www\./, '')
    if (!domain && knownWithoutWebsite(db.getProspectCompany(c.ref), db, canSearchWeb, now)) {
      out.add(c.ref)
      noWebsite++
    } else if (!domain) {
      noDomain++
    } else if (worthIt(domain)) {
      continue
    } else if (knownDeadEnd(domain, known, now)) {
      out.add(c.ref)
      unverifiable++
    } else {
      unknown.push({ ref: c.ref, domain })
    }
  }
  // In a hosted copy, companies another copy there has found out about: kept here, and not checked again.
  const shared = await sharedCatchAllVerdicts(unknown.map(({ ref, domain }) => ({ ref, domain })))
  const toCheck = unknown.filter((u, i) => {
    keepSharedVerdict(db, u.domain, shared[i])
    if (shared[i]?.catchAll === false && shared[i]?.checkedAt) return false
    if (shared[i]?.catchAll !== true) return true
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
        answered.set(domain, rec.accepts_mail === false || rec.catch_all === true || isKnownSilent(domain, known, Date.now()))
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
  return { keep: companies.filter((c) => !out.has(c.ref)), unverifiable, noDomain, noWebsite }
}

/** How likely a Reveal is to find someone's email, from what was known of their mail domain (PersonResult.mailCheck). */
const FINDABLE: Record<string, number> = { pattern: 0, tested: 1, untested: 2, deadEnd: 4 }
const findableFirst = (people: PersonResult[]) =>
  people
    .map((p, i) => ({ p, i, rank: p.mailCheck ? FINDABLE[p.mailCheck] : 3 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.p)

/** The most a batch waits for its failed website lookups to be tried again. */
const RETRY_MS = 15_000

/**
 * A company known to have no website to find an email on: its LinkedIn page
 * was read and lists none, and either this copy has no web search to look
 * further or one lately found none that's plainly theirs. Its people would
 * be hidden after their profiles were read, so they're left out before.
 */
function knownWithoutWebsite(row: { name: string; domain: string | null; page_checked?: boolean } | null | undefined, db: Db, canSearchWeb: boolean, now = Date.now()): boolean {
  if (!row?.page_checked || row.domain) return false
  return !canSearchWeb || knownToHaveNoSite(row.name, db, now)
}

/**
 * What the host knows of a domain this copy also knows, kept here with when
 * the host found out (never as now, so it's kept no longer than the host
 * would): no made-up address need be checked there, and its people can be
 * hidden or marked tested before anyone sees them. Not when this copy's own
 * answer is newer.
 */
function keepSharedVerdict(db: Db, domain: string | null | undefined, verdict: SharedVerdict | null) {
  if (!domain || verdict?.catchAll === null || verdict?.catchAll === undefined || !verdict.checkedAt) return
  // An unconfirmed "accepts every address" isn't kept: a Reveal there still makes the confirming check.
  if (verdict.catchAll && !verdict.confirmed) return
  const d = domain.toLowerCase().trim().replace(/^www\./, '')
  const rec = db.getEmailDomain(d)
  if (rec?.catch_all_checked_at && rec.catch_all_checked_at >= verdict.checkedAt) return
  db.upsertEmailDomain(d, {
    catch_all: verdict.catchAll,
    catch_all_source: verdict.catchAll ? 'shared' : null,
    catch_all_confirmed: Boolean(verdict.confirmed),
    catch_all_checked_at: verdict.checkedAt,
    catch_all_recheck_at: null,
  })
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
    return !domain || worthIt(domain) || !knownDeadEnd(domain, known, now)
  })
  screened.unverifiable += companies.length - keep.length
  return keep
}

/**
 * The Warm filter's companies: the workspace's warm ones with a LinkedIn id,
 * most recent first, of the chosen sizes where their staff count is known.
 */
function warmCompanies(db: Db, filters: PeopleFilters): Array<{ ref: string; name: string }> {
  const sizes = filters.companySizes ?? []
  const headcount = new Map((db.data.prospect_companies ?? []).map((c) => [c.ref, c.headcount ?? null]))
  return warmTargets(warmIndex(db.data)).filter((c) => {
    const n = headcount.get(c.ref)
    return !sizes.length || n === null || n === undefined || inHeadcountBuckets(n, sizes)
  })
}

/** What hiring and funding screening found, added up over a page (searchLog.ts counts). */
interface SignalTally {
  /** Companies left out for having none of the signals asked for. */
  noSignal: number
  /** Companies put back to wait for their signals to be looked up. */
  waiting: number
}

/** How long a batch waits for its companies' signals to be looked up. */
const SIGNALS_WAIT_MS = 20_000
const SIGNALS_NEED_TERM = 'Hiring and Raised funding need an industry or keyword, to find the companies first.'

/**
 * A companies-first batch, keeping only companies with one of these signals
 * (companySignals.ts): looked up now, waiting up to SIGNALS_WAIT_MS. One
 * not looked up in time goes back to the end of the queue (`later`), once,
 * and is left out the second time. Each kept company comes with its signals.
 */
async function screenBySignals(
  batch: Array<[ref: string, name: string]>,
  kinds: readonly WebSignalKind[],
  db: Db,
  waited: string[],
  tally: SignalTally,
): Promise<{ keep: Array<[string, string]>; signals: Signal[][]; later: Array<[string, string]> }> {
  const known = new Map((db.data.prospect_companies ?? []).map((c) => [c.ref, c.domain]))
  const list = batch.map(([ref, name]) => ({ ref, name, domain: known.get(ref) ?? null }))
  const answer = await companySignals(list, { kinds, liveMax: list.length, waitMs: SIGNALS_WAIT_MS })
  const keep: Array<[string, string]> = []
  const signals: Signal[][] = []
  const later: Array<[string, string]> = []
  for (const c of list) {
    const key = signalKey(c)
    const found = (key ? answer.signals[key] : undefined)?.filter((s) => kinds.includes(s.kind as WebSignalKind)) ?? []
    if (found.length) {
      keep.push([c.ref, c.name])
      signals.push(found)
    } else if (key && answer.pending.includes(key) && !waited.includes(c.ref)) {
      later.push([c.ref, c.name])
      tally.waiting++
    } else tally.noSignal++
  }
  return { keep, signals, later }
}

/**
 * Whether a batch of companies is searched once with no job title
 * (PeopleFilters.noTitle) instead of once a title: only where every company
 * has 10 staff or fewer (by the staff count kept from company search, or the
 * size searched for), and few enough work at them all for that to cost less
 * (members ≤ 50 × (title requests − 1)). Checked against the live API
 * (2026-10-17): at two batches of 20 companies of 2-10 staff, two requests a
 * batch found 36 of the 40 founders and owners the five title requests found,
 * and 2 the title requests missed.
 */
function searchedWithoutTitle(refs: string[], filters: PeopleFilters, db: Db, fromSizeSearch: boolean): boolean {
  const requests = searchesForTitles(filters.titles, { small: onlySmallCompanies(filters.companySizes) })
  if (!noTitleBatches() || requests < 2 || !filters.titles?.length) return false
  // A staff count not known is taken as the size searched for only for companies that search found by it (not warm ones).
  const onlyTiny = fromSizeSearch && filters.companySizes?.length === 1 && filters.companySizes[0] === '1-10'
  let members = 0
  for (const ref of refs) {
    const staff = db.getProspectCompany(ref)?.headcount ?? (onlyTiny ? 10 : null)
    if (staff === null || staff === undefined || staff > 10) return false
    members += staff
  }
  return members <= MAX_PER_REQUEST * (requests - 1)
}

/** The same for one company searched on its own: one request brings everyone at a company of up to 50. */
function singleWithoutTitle(ref: string, filters: PeopleFilters, db: Db, fromSizeSearch: boolean): boolean {
  const requests = searchesForTitles(filters.titles, { small: onlySmallCompanies(filters.companySizes) })
  if (!noTitleBatches() || requests < 2 || !filters.titles?.length) return false
  const sizes = fromSizeSearch ? (filters.companySizes ?? []) : []
  const top = sizes.length && sizes.every((s) => s === '1-10' || s === '11-50') ? (sizes.includes('11-50') ? 50 : 10) : null
  const staff = db.getProspectCompany(ref)?.headcount ?? top
  return staff !== null && staff !== undefined && staff <= MAX_PER_REQUEST
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
  /** People each title's request is asked for, and the people the page still needs (all of it for a request with no title). */
  count: number,
  need: number,
  /** Leave out companies where no email can be verified (screenCompanies), counting them here. */
  screened?: { unverifiable: number; noDomain: number; noWebsite: number },
  /** Hiring and funding filters: what screening left out, counted here. */
  signalTally: SignalTally = { noSignal: 0, waiting: 0 },
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
  /** Hiring and funding filters: the signals of the companies searched, by ref, for their people. */
  signals: Map<string, Signal[]>
  /** This page is a newly filled batch's first (not a later page of it, nor companies searched one at a time). */
  firstOfBatch?: boolean
}> {
  const { canonicalCountry } = await import('./geo')
  const { MAX_COMPANIES_PER_SEARCH } = await import('./socialfetch')
  // How many companies a batch is filled to: SocialFetch takes 20 a search, a web search more (webSource.ts).
  const perBatch = source.companiesPerSearch ?? MAX_COMPANIES_PER_SEARCH
  // With the Warm filter, the companies are the workspace's warm ones: no company search.
  const warm = Boolean(filters.signals?.includes('warm'))
  // Hiring and funding filters: each batch keeps only companies with one (screenBySignals). Warm takes them all.
  const webKinds = warm ? [] : WEB_SIGNAL_KINDS.filter((k) => filters.signals?.includes(k))
  const batchSignals = new Map<string, Signal[]>()
  const terms = warm ? [] : companyTerms(filters)
  const wantCountry = canonicalCountry(filters.country)
  let s = decodeState(cursor)
  let orgSearches = 0
  let found = 0
  let orgTotal: number | null = null
  const hasMore = (next: CompanyFirstState) =>
    next.batch.length > 0 || next.pending.length > 0 || Boolean(next.singles?.length) || next.orgCursor !== undefined || next.term < terms.length || (warm && !next.warm)

  // Companies split from a batch: a few searched at once, each on its own, so
  // everyone found is known to work there and no profile is looked up.
  if (!s.batch.length && s.singles?.length) {
    const now = s.singles.slice(0, Math.max(1, Math.floor(SINGLE_REQUESTS_AT_ONCE / searchesForTitles(filters.titles, { small: onlySmallCompanies(filters.companySizes) }))))
    const pages = await Promise.all(
      now.map(([ref, name, people]) => {
        // A small company is searched once for everyone there rather than once a title (carrying on the way it began),
        // and that one request takes what the page still needs.
        const noTitle = people ? cursorIsNoTitle(people) : singleWithoutTitle(ref, filters, db, !warm)
        return source.searchPeople(
          { ref, name },
          {
            titles: filters.titles,
            seniorities: filters.seniorities,
            country: filters.country,
            count: noTitle ? Math.min(MAX_PER_REQUEST, Math.max(1, need)) : count,
            cursor: people,
            smallCompanies: onlySmallCompanies(filters.companySizes),
            noTitle,
          },
        )
      }),
    )
    const items: PersonResult[] = []
    const funnel: NonNullable<Page<PersonResult>['funnel']> = { hits: 0, offTitle: 0, filteredOut: 0, related: 0, uniqueHits: 0, uniqueOffTitle: 0, emptyRequests: 0, joinerRetries: 0, onlyByTitle: [] }
    const carryOn: NonNullable<CompanyFirstState['singles']> = []
    pages.forEach((page, i) => {
      const [ref, name] = now[i]
      // Anyone whose headline names another employer was left out by the search.
      for (const p of page.items) items.push({ ...p, company: name, companyRef: ref })
      const f = page.funnel
      funnel.hits += f?.hits ?? page.items.length
      funnel.offTitle += f?.offTitle ?? 0
      funnel.filteredOut += f?.filteredOut ?? 0
      funnel.related! += f?.related ?? 0
      funnel.uniqueHits! += f?.uniqueHits ?? f?.hits ?? page.items.length
      funnel.uniqueOffTitle! += f?.uniqueOffTitle ?? f?.offTitle ?? 0
      funnel.emptyRequests! += f?.emptyRequests ?? 0
      funnel.joinerRetries! += f?.joinerRetries ?? 0
      if (f?.webPages) {
        funnel.webPages = (funnel.webPages ?? 0) + f.webPages
        funnel.webTries = (funnel.webTries ?? 0) + (f.webTries ?? 0)
        funnel.webPaid = (funnel.webPaid ?? 0) + (f.webPaid ?? 0)
      }
      f?.onlyByTitle?.forEach((n, j) => (funnel.onlyByTitle![j] = (funnel.onlyByTitle![j] ?? 0) + n))
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
      signals: batchSignals,
    }
  }
  // The batch is filled to perBatch before its people are searched: a people
  // search costs the same for 2 companies as for 20, so the few left over from one page of
  // companies wait for the next page (usually held already, at no cost) instead of being
  // searched on their own. A few company pages at most, in case pages come back with none that fit.
  const filling: Array<[string, string]> = []
  // Companies put back to wait for their signals: not taken again while this batch fills.
  const deferred: Array<[string, string]> = []
  let signalScreens = 0
  const canFind = () => !warm && Boolean(source.searchCompanies) && (s.orgCursor !== undefined || s.term < terms.length)
  for (let guard = 0; guard < 6 && !s.batch.length; guard++) {
    const room = perBatch - filling.length
    // Hiring and funding: each screening waits up to SIGNALS_WAIT_MS, so a batch fills from two at most.
    if (webKinds.length > 0 && signalScreens >= 2) {
      if (filling.length) s = { ...s, batch: filling.splice(0), people: undefined }
      break
    }
    if (s.pending.length && (s.pending.length >= room || !canFind())) {
      const pending = screened ? await withoutUnverifiable(s.pending, db, screened) : s.pending
      const next = pending.slice(0, room)
      if (webKinds.length) {
        // Only companies with the signals asked for go on to the people search.
        signalScreens++
        const r = await screenBySignals(next, webKinds, db, s.waited ?? [], signalTally)
        filling.push(...r.keep)
        deferred.push(...r.later)
        s = { ...s, pending: pending.slice(next.length), waited: [...(s.waited ?? []), ...r.later.map(([ref]) => ref)].slice(-200) }
        r.keep.forEach(([ref], i) => batchSignals.set(ref, r.signals[i]))
      } else {
        filling.push(...next)
        s = { ...s, pending: pending.slice(next.length) }
      }
      // Full, or as full as it will get.
      if (filling.length >= perBatch || (!s.pending.length && !canFind())) {
        s = { ...s, batch: filling.splice(0), people: undefined }
        break
      }
      continue
    }
    if (warm) {
      if (s.warm) break
      const targets = warmCompanies(db, filters)
      found += targets.length
      s = { ...s, warm: true, pending: targets.map((c) => [c.ref, c.name] as [string, string]) }
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
      screened.noWebsite += r.noWebsite
    }
    // Added to those still waiting, which carry over from the last page of companies (or industry);
    // a company found again (under a second industry, say) isn't queued twice.
    const queued = new Set([...s.pending, ...filling, ...deferred].map(([ref]) => ref))
    const added = fits.filter((c) => !queued.has(c.ref) && (queued.add(c.ref), true)).map((c) => [c.ref, c.name] as [string, string])
    s = {
      ...s,
      pending: [...s.pending, ...added],
      orgCursor: res.nextCursor ?? undefined,
      term: res.nextCursor ? s.term : s.term + 1,
    }
  }
  // Whatever filled before the tries ran out is searched; companies waiting for their signals go back at the end.
  if (!s.batch.length && filling.length) s = { ...s, batch: filling.splice(0), people: undefined }
  if (deferred.length) s = { ...s, pending: [...s.pending, ...deferred] }
  const companies = new Map(s.batch)
  if (!s.batch.length) {
    // No batch after a few tries (the companies found were all left out): carry on from here if
    // there are more to find, rather than end a search with hundreds of companies still to come.
    return {
      page: { items: [], nextCursor: hasMore(s) ? encodeState(s) : null, reportedTotal: null, warnings: [], details: [], requests: 0 },
      companies,
      orgSearches,
      found,
      orgTotal,
      splitCursor: null,
      batchHasMore: false,
      signals: batchSignals,
    }
  }
  const splitCursor =
    s.batch.length > 1 && !s.people
      ? encodeState({ ...s, batch: [], people: undefined, singles: [...s.batch.map(([ref, name]) => [ref, name] as [string, string]), ...(s.singles ?? [])] })
      : null

  const firstOfBatch = !s.people
  // A batch of small enough companies is searched once for everyone there rather than once a title,
  // its later pages carrying on the way its first began; that one request takes what the page still needs.
  const noTitle = s.people ? cursorIsNoTitle(s.people) : searchedWithoutTitle(s.batch.map(([ref]) => ref), filters, db, !warm)
  const page = await source.searchPeople(null, {
    titles: filters.titles,
    seniorities: filters.seniorities,
    country: filters.country,
    companyRefs: s.batch.map(([ref]) => ref),
    companyNames: Object.fromEntries(s.batch),
    smallCompanies: onlySmallCompanies(filters.companySizes),
    count: noTitle ? Math.min(MAX_PER_REQUEST, Math.max(1, need)) : count,
    cursor: s.people,
    noTitle,
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
    signals: batchSignals,
    firstOfBatch,
  }
}

/**
 * Of these people, whose profiles were looked up, those whose current
 * employer `fits`, each with that employer. One company lookup per company;
 * one that can't be looked up doesn't fit.
 */
async function employersFitting(people: PersonResult[], source: Source, fits: (company: CompanyResult) => boolean): Promise<Map<string, CompanyResult>> {
  const out = new Map<string, CompanyResult>()
  const getCompany = source.getCompany?.bind(source)
  if (!getCompany) return out
  const companies = new Map<string, Promise<CompanyResult | null>>()
  await mapLimit(
    people.filter((p) => p.companyRef),
    ENRICH_CONCURRENCY,
    async (p) => {
      const ref = p.companyRef!
      if (!companies.has(ref)) companies.set(ref, getCompany(ref, p.companySlug ?? null).catch(() => null))
      const company = await companies.get(ref)!
      if (company && fits(company)) out.set(p.profileUrl, company)
    },
  )
  return out
}

/** Whether a company fits a search's industries and company sizes. */
function fitsFilters(company: CompanyResult, filters: PeopleFilters): boolean {
  const industries = (filters.industries ?? []).map((i) => i.trim().toLowerCase()).filter(Boolean)
  if (industries.length && !(company.industry && industries.includes(company.industry.trim().toLowerCase()))) return false
  return inHeadcountBuckets(company.headcount, filters.companySizes ?? [])
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
  /**
   * Profile lookups cost nothing (the host's profileLookupsFree): everyone's
   * profile is looked up rather than their employer taken from the search,
   * and in a companies-first search someone whose real employer isn't one of
   * the companies searched is kept when it `fits` the filters.
   */
  free?: { fits: ((company: CompanyResult) => boolean) | null },
  /** Whether a job title is one searched for: a second current job at a company searched is taken only with this or the headline's word (refine.ts). */
  titleFits?: (title: string) => boolean,
): Promise<{
  items: PersonResult[]
  refined: string[]
  lookupError?: string
  lookedUp: string[]
  shared: number
  spared: number
  split?: boolean
  /** People whose profile couldn't be confirmed: left out of `items`, for the page to ask about again or leave out. */
  unconfirmed: PersonResult[]
}> {
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
    const remembered = unverifiableEntries(db)
    if (remembered.size > 0) {
      // Not those every address was rejected for by an older way of guessing, when today's tries
      // other addresses, or their company has since been given a domain by hand.
      const stillOut = (p: PersonResult) => {
        const entry = remembered.get(profileHash(p.profileUrl) ?? '')
        if (!entry) return false
        if (entry.outcome !== 'rejected') return true
        const userDomain = p.companyRef ? db.getProspectCompany(p.companyRef) : null
        if (userDomain?.domain_source === 'user' && (userDomain.updated_at ?? '') > entry.created_at) return false
        return (entry.finder ?? 1) >= FINDER_VERSION || !guessesChangedFor(p.firstName, p.lastName)
      }
      const keep = items.filter((p) => !stillOut(p))
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
  // A name typed on a profile, with no company page behind it, says where
  // someone works only when it could be a company's: LinkedIn's search files
  // everyone who typed "clean" or "food industry" under a company of that name.
  const typedAt = (p: Employer, name: string) => plainlySameCompany(p.company, name, Boolean(p.companyRef)) && (Boolean(p.companyRef) || isCompanyName(p.company))
  // Another company of the same name: the employer's LinkedIn page isn't the searched company's.
  // A web search finds people by the companies' names, and small companies share them (a fifth of
  // hq's with 50 or fewer staff shared theirs with another it had found, 2026-10-18): their emails
  // were guessed at the wrong company's domain, most refused. Only where both pages are known by
  // name; a numeric id says nothing against a name.
  const pageName = (v: string | null | undefined) => (v && !/^\d+$/.test(v) ? v.toLowerCase() : null)
  const otherPage = (e: Employer, ref: string) => {
    const theirs = pageName(db.getProspectCompany(ref)?.slug)
    const mine = pageName(e.companySlug) ?? pageName(e.companyRef)
    return Boolean(theirs && mine && theirs !== mine)
  }
  // Whether an employer is one this search is for: the chosen company, or one of a companies-first batch.
  const atSearched: ((e: Employer) => boolean) | undefined = company
    ? (e) => e.companyRef === company.ref || (typedAt(e, company.name) && !otherPage(e, company.ref))
    : companySet?.size
      ? (e) => Boolean(e.companyRef && companySet.has(e.companyRef)) || [...companySet].some(([ref, n]) => typedAt(e, n) && !otherPage(e, ref))
      : undefined
  const knownEmployer = (p: PersonResult): { ref: string; name: string } | null => {
    if (p.previously === 'saved' || p.profileChecked) return null
    // A company search also finds people who list it without working there
    // (members of a society, say): with lookups free, everyone is checked. A
    // web search result's employer too, which can be a job they've since left:
    // taken without a lookup (0.9.99-0.9.103), 1 in 16 of their emails was
    // verified, against about 1 in 3 looked up (hq, 2026-10-18).
    if (free) return null
    if (p.source === 'web') {
      if (!p.company.trim()) return null
      if (company && (p.companyRef === company.ref || typedAt(p, company.name))) return company
      if (companySet?.size && p.companyRef && companySet.has(p.companyRef)) return { ref: p.companyRef, name: companySet.get(p.companyRef)! }
      if (companySet?.size) for (const [ref, name] of companySet) if (typedAt(p, name)) return { ref, name }
      return null
    }
    if (company && /^\d+$/.test(company.ref)) return company
    if (companySet?.size && p.companyRef && companySet.has(p.companyRef)) return { ref: p.companyRef, name: companySet.get(p.companyRef)! }
    if (companySet?.size && p.company) {
      for (const [ref, name] of companySet) if (typedAt(p, name)) return { ref, name }
    }
    return null
  }
  const noLookup = new Set<string>()
  items = items.map((p) => {
    const at = knownEmployer(p)
    if (!at) return p
    noLookup.add(p.profileUrl)
    if (p.source === 'web') tally.employerFromListing++
    return { ...p, company: at.name, companyRef: at.ref, companyDomain: db.getProspectCompany(at.ref)?.domain ?? null }
  })
  tally.noLookup += noLookup.size

  // In a companies-first search, SocialFetch's company filter also finds
  // people who used to work at one of the companies: someone whose headline
  // names another employer has moved on, so no profile is paid for to find
  // that out (it was most of the profiles paid for in these searches). With
  // lookups free, a web search result naming another employer is left out
  // too, rather than read in case that employer fits: on hq that kept 4 of
  // the 36 read (2026-10-18), each read about a second of the search.
  if (companySet?.size) {
    const names = [...companySet.values()]
    const elsewhere = new Set(
      items
        .filter((p) => (!free || p.source === 'web') && p.previously !== 'saved' && !p.profileChecked && !noLookup.has(p.profileUrl) && p.company.trim() && !names.some((n) => sameCompanyName(p.company, n)))
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

  // People the host's shared database already holds (sharedPeople.ts): their
  // job and employer come from it, so no profile is paid for, and so does
  // their verified email when it's asked for. Taken where their headline
  // names the same employer, or names none and their email was verified
  // lately; anyone else is looked up as usual, since they may have moved on.
  const held = await knownPeople(items.filter((p) => p.previously !== 'saved'))
  const fromShared = new Set<string>()
  if (held.size) {
    items = items.map((p) => {
      const k = held.get(p.profileUrl)
      if (!k || p.previously === 'saved') return p
      const sameEmployer = Boolean((p.companyRef && p.companyRef === k.companyRef) || (p.company.trim() && sameCompanyName(p.company, k.company)))
      const lately = Date.now() - new Date(k.verifiedAt).getTime() < SHARED_FRESH_MS
      if (!sameEmployer && !(lately && !p.company.trim() && !p.companyRef)) return p
      fromShared.add(p.profileUrl)
      return {
        ...p,
        title: k.title || p.title,
        seniority: k.title ? k.seniority : p.seniority,
        company: k.company,
        companyRef: k.companyRef ?? p.companyRef,
        companyDomain: k.companyDomain ?? p.companyDomain,
        country: p.country ?? k.country,
        profileChecked: true,
        shared: k.handle,
      }
    })
  }
  // Those whose profile would otherwise have been paid for.
  const spared = [...fromShared].filter((url) => !noLookup.has(url))

  // A web search result (webSource.ts) usually names the employer, unlike a SocialFetch hit. Where
  // lookups cost credits that's taken as it stands; where they're free, the profile is still read for
  // their current job (Google's can be one they've left: unread, 1 in 16 of their emails was verified,
  // 2026-10-18), and if it can't be, the result's employer is kept rather than the person left out.
  const listedEmployer = (p: PersonResult) => p.source === 'web' && Boolean(p.company.trim())
  const fromListing = new Set(
    free ? [] : items.filter((p) => p.previously !== 'saved' && !noLookup.has(p.profileUrl) && !fromShared.has(p.profileUrl) && listedEmployer(p)).map((p) => p.profileUrl),
  )
  const toLookUp = items.filter((p) => p.previously !== 'saved' && !noLookup.has(p.profileUrl) && !fromShared.has(p.profileUrl) && !fromListing.has(p.profileUrl))
  if (toLookUp.length && splitWhen?.(toLookUp.length)) {
    Object.assign(tally, counted)
    return { items: [], refined: [], lookedUp: [], shared: 0, spared: 0, split: true, unconfirmed: [] }
  }

  const refined: string[] = []
  let lookupError: string | undefined
  let unconfirmed: PersonResult[] = []
  const notRead = new Set<string>()
  const worthIt = await formatConfirmedAt(db)
  // Each company's mail domain is tested as soon as its website is known,
  // while the rest of the batch is still being worked out (domainTests).
  const tests = hideUnverifiable ? domainTests() : null
  const testSoon = (domain: string | null | undefined) => {
    if (domain && !worthIt(domain)) tests?.start(domain)
  }
  if (toLookUp.length > 0) {
    // Check the first profile before paying for the rest: if the lookup
    // itself fails (no credits, API down) the rest would fail too. A profile
    // that simply lists no company page (freelancers, tiny firms) is normal
    // and doesn't stop the others.
    // Which of someone's jobs was taken, counted: another at a company searched, or one refused for want of evidence.
    const jobs = { titleFits, noted: (how: 'other' | 'refused') => void (how === 'other' ? tally.otherJob++ : tally.otherJobRefused++) }
    // As each profile comes back placing someone at a company searched, that company's mail domain
    // starts being tested (if known), rather than after every profile in the batch has been read.
    const lookUp = async (p: PersonResult) => {
      const r = await enrichOne(p, source, db, atSearched, jobs)
      const ref = r.person.companyRef
      if (ref && (companySet?.has(ref) || company?.ref === ref)) testSoon(r.person.companyDomain ?? db.getProspectCompany(ref)?.domain)
      return r
    }
    const first = await lookUp(toLookUp[0])
    const results = first.error ? [first] : [first, ...(await mapLimit(toLookUp.slice(1), ENRICH_CONCURRENCY, lookUp))]
    const byUrl = new Map(results.map((r) => [r.person.profileUrl, r.person]))
    items = items.map((p) => byUrl.get(p.profileUrl) ?? p)
    for (const r of results) if (r.refined) refined.push(r.person.profileUrl)
    // Nothing is known of where they work, so they aren't shown: the page
    // finds others instead, and asks about them again if it runs short.
    // Unless a web search result said where (listedEmployer).
    results.filter((r) => r.unconfirmed).forEach((r) => notRead.add(r.person.profileUrl))
    const listed = results.filter((r) => r.unconfirmed && listedEmployer(r.person)).map((r) => r.person.profileUrl)
    listed.forEach((url) => fromListing.add(url))
    unconfirmed = results.filter((r) => r.unconfirmed && !listedEmployer(r.person)).map((r) => r.person)
    if (unconfirmed.length) {
      const dropped = new Set(unconfirmed.map((p) => p.profileUrl))
      items = items.filter((p) => !dropped.has(p.profileUrl))
    }
    if (first.error) {
      lookupError = first.error
    } else {
      const failed = results.filter((r) => r.error)
      tally.failed += failed.length
      tally.failedError ??= failed[0]?.error
      tally.noJob += results.length - refined.length - failed.length - unconfirmed.length - listed.length
    }
  }
  // Their employer is known as surely as from a lookup, so the checks below apply to them too.
  refined.push(...spared)
  tally.employerFromListing += fromListing.size
  // Where they work is known, from their profile or a web search result: what's placed and marked below.
  const placeable = (p: PersonResult) => Boolean(p.profileChecked) || fromListing.has(p.profileUrl)

  // Contacts added another way (imported, a form) only show up once their
  // employer is known: the same name at the same company.
  if (!includeContacts && (refined.length > 0 || noLookup.size > 0 || fromListing.size > 0)) {
    const isContact = contactMatcher(db)
    const fresh = items.filter((p) => !((refined.includes(p.profileUrl) || noLookup.has(p.profileUrl) || fromListing.has(p.profileUrl)) && isContact(p)))
    const dropped = items.filter((p) => !fresh.includes(p))
    tally.inContacts += dropped.length
    tally.paidInContacts += dropped.filter((p) => refined.includes(p.profileUrl) && !fromShared.has(p.profileUrl)).length
    items = fresh
  }

  // A profile named for a business ("Business Exit Advisors", employer
  // Business Exit Advisors) is the business's, not a person's: there's no
  // name to work an address out from.
  {
    const people = items.filter((p) => !(p.company.trim() && companyKey(`${p.firstName} ${p.lastName}`) === companyKey(p.company)))
    tally.noSurname += items.length - people.length
    items = people
  }

  // With the real employer known, people who don't work at the chosen
  // company can be dropped.
  // Someone a lookup taught nothing (no current job) is kept where the search itself said where they
  // work: SocialFetch's company filter does; a web search result doesn't, as Google matches a company's
  // name anywhere on a profile. Kept, half of a web search's people had no employer to find an email
  // at: all 7 of those revealed came back with no domain (hq-style search, 2026-10-19).
  const placedBySearch = (p: PersonResult) => !refined.includes(p.profileUrl) && p.source !== 'web'
  if (company && atSearched) {
    const atCompany = items.filter((p) => placedBySearch(p) || atSearched(p))
    tally.wrongCompany += items.length - atCompany.length
    items = atCompany
  } else if (companySet?.size && atSearched) {
    // Someone who has moved on since LinkedIn indexed them isn't at one of them any more.
    const atOne = (p: PersonResult) => placedBySearch(p) || atSearched(p)
    // Unless, with lookups free, where they do work fits the filters too.
    const fitting = free?.fits ? await employersFitting(items.filter((p) => !atOne(p)), source, free.fits) : new Map<string, CompanyResult>()
    const kept = items
      .filter((p) => atOne(p) || fitting.has(p.profileUrl))
      .map((p) => {
        const at = fitting.get(p.profileUrl)
        return at ? { ...p, company: at.name, companyDomain: at.domain ?? p.companyDomain } : p
      })
    tally.wrongCompany += items.length - kept.length
    // Of those, any whose employer's page name is a searched company's (a name written differently, not a move).
    if (kept.length < items.length) {
      const slugs = new Set((db.data.prospect_companies ?? []).filter((c) => companySet.has(c.ref) && c.slug).map((c) => c.slug!.toLowerCase()))
      tally.wrongCompanySameSlug += items.filter((p) => !kept.some((k) => k.profileUrl === p.profileUrl) && p.companyRef && slugs.has(p.companyRef.toLowerCase())).length
    }
    items = kept
  }

  // Someone whose profile names an employer without linking its company page
  // has no company to read a website from, so no email can be found for
  // them. Where the name is one of the companies this page searched inside,
  // or we know exactly one company by it, they're taken to work there;
  // otherwise they're marked, and hidden with the others whose email can't
  // be verified. Only once their profile has been checked: before that,
  // saving them may still find where they work.
  const named = companyNamer(db)
  // People whose employer's name more than one known company goes by: no guessing which.
  const several = new Set<string>()
  items = items.map((p) => {
    if (p.companyRef || p.companyDomain || p.previously === 'saved') return p
    const searched = p.company.trim() ? [...(companySet ?? [])].find(([, name]) => typedAt(p, name)) : undefined
    const byName = searched || !isCompanyName(p.company) ? null : named(p.company)
    if (byName === 'several') several.add(p.profileUrl)
    const known = searched ? db.getProspectCompany(searched[0]) ?? { ref: searched[0], domain: null, slug: null } : byName === 'several' ? null : byName
    if (known) {
      tally.employerByName++
      return { ...p, companyRef: known.ref, companySlug: p.companySlug ?? known.slug ?? null, companyDomain: isPlatformDomain(known.domain) ? null : (known.domain ?? null) }
    }
    return p
  })
  // With the host's lookups free, the rest are worth a look at the page each
  // employer's name would have (findCompanyByName): many people type their
  // employer in rather than pick its page. Otherwise that waits for a reveal.
  const unplaced = items.filter((p) => !p.companyRef && !p.companyDomain && p.previously !== 'saved' && placeable(p))
  const getCompany = source.getCompany?.bind(source)
  const searchWeb = webSearcher()
  for (const p of items) if (p.previously !== 'saved') testSoon(p.companyDomain)

  // Those whose employer has no LinkedIn page that we know of: the page its
  // name would have, where the host's lookups are free, and failing that its
  // own website by web search (companySite.ts), where this copy has one to
  // use. A small firm whose founder typed its name in usually still has a
  // website. Where the search turns up a LinkedIn page for it after all, the
  // website is read from there.
  type Placed = { ref?: string; slug?: string | null; domain: string | null; searched: boolean }
  const placed = new Map<string, Placed>()
  // A page guess or web search that failed (undefined) has said nothing: tried once more at the
  // end of the batch, and if it fails again its people are left out as before, but nothing is
  // remembered, so a later page or search tries again (siteLookupFailed).
  const failedPlacing = new Set<PersonResult>()
  const failedSites = new Set<PersonResult>()
  const placeOne = async (p: PersonResult) => {
    const page = free && getCompany ? await findCompanyByName(p.company, { getCompany }, db).catch(() => undefined) : null
    const name = page?.name ?? p.company
    // A page with no website on it is as good as no page: the web is searched either way.
    const reader = !page && free && getCompany ? companyPageReader(p.company, { getCompany }, db) : undefined
    const site =
      page?.domain || !searchWeb || !isCompanyName(name) ? null : await findCompanySite(name, p.country, searchWeb, db, Date.now(), reader).catch(() => undefined)
    const domain = page?.domain ?? site ?? null
    testSoon(domain)
    if (page || domain) placed.set(p.profileUrl, { ref: page?.ref, slug: page?.slug, domain, searched: Boolean(site) })
    // Something failed and no website was found: worth asking once more.
    if (!domain && (page === undefined || site === undefined)) failedPlacing.add(p)
    else failedPlacing.delete(p)
  }
  const placeUnlinked = mapLimit(unplaced.filter((p) => p.company.trim() && !several.has(p.profileUrl)), ENRICH_CONCURRENCY, placeOne)

  // Someone at a company with a LinkedIn page whose website we don't know
  // yet: a Reveal would read the page for it, and find nothing if the page
  // lists none. With the host's lookups free the page is read now instead,
  // and a company with no website on its page is looked for on the web.
  // Where there's none to be found, its people are marked like those with no
  // company page; a page that couldn't be read says nothing either way.
  const unsited = free && getCompany ? items.filter((p) => p.companyRef && !p.companyDomain && p.previously !== 'saved' && placeable(p)) : []
  const sites = new Map<string, { domain: string | null; searched: boolean }>()
  const readOne = async (p: PersonResult) => {
    const ref = p.companyRef!
    const read = !db.getProspectCompany(ref)?.page_checked
    const onPage = await companyWebsite(ref, p.company, { getCompany: getCompany! }, db, p.companySlug).catch(() => undefined)
    if (onPage === undefined) return
    if (read) tally.companyPagesRead++
    const name = db.getProspectCompany(ref)?.name ?? p.company
    const found = onPage || !searchWeb || !isCompanyName(name) ? null : await findCompanySite(name, p.country, searchWeb, db).catch(() => undefined)
    testSoon(onPage ?? found)
    if (found === undefined) {
      failedSites.add(p)
      return
    }
    failedSites.delete(p)
    sites.set(ref, { domain: onPage ?? found, searched: Boolean(found) })
  }
  const readPages = mapLimit([...new Map(unsited.map((p) => [p.companyRef!, p])).values()], ENRICH_CONCURRENCY, readOne)

  // The two don't wait on each other: one is about people with no company page, the other about people with one.
  await Promise.all([placeUnlinked, readPages])
  // Those that failed, once more: one ask per employer (its people share the answer), a few at a
  // time (a failed search is often a busy one), and for no more than RETRY_MS in all.
  if (failedPlacing.size || failedSites.size) {
    const byName = new Map<string, PersonResult[]>()
    for (const p of failedPlacing) byName.set(companyKey(p.company), [...(byName.get(companyKey(p.company)) ?? []), p])
    const retry = Promise.all([
      mapLimit([...byName.values()], 2, async ([first, ...others]) => {
        await placeOne(first)
        for (const p of others) {
          const found = placed.get(first.profileUrl)
          if (found) placed.set(p.profileUrl, found)
          if (!failedPlacing.has(first)) failedPlacing.delete(p)
        }
      }),
      mapLimit([...failedSites], 2, readOne),
    ])
    await Promise.race([retry, new Promise((r) => setTimeout(r, RETRY_MS))])
    // Still nothing: left out like those with no website, until a later search asks again. Counted by person.
    const stillFailed = new Set(failedSites)
    tally.siteLookupFailed += failedPlacing.size + unsited.filter((p) => [...stillFailed].some((f) => f.companyRef === p.companyRef)).length
    for (const p of failedSites) sites.set(p.companyRef!, { domain: null, searched: false })
  }

  items = items.map((p) => {
    if (p.previously === 'saved' || !placeable(p) || p.companyDomain) return p
    if (p.companyRef) {
      const site = unsited.includes(p) ? sites.get(p.companyRef) : undefined
      if (!site) return p
      if (site.domain) {
        if (site.searched) tally.employerBySite++
        return { ...p, companyDomain: site.domain }
      }
      tally.noWebsite++
      return { ...p, noCompany: true }
    }
    const found = placed.get(p.profileUrl)
    if (found?.ref) {
      tally.employerByGuess++
      if (found.searched) tally.employerBySite++
      if (!found.domain) tally.noWebsite++
      return { ...p, companyRef: found.ref, companySlug: p.companySlug ?? found.slug ?? null, companyDomain: found.domain, ...(found.domain ? {} : { noCompany: true }) }
    }
    if (found?.domain) {
      tally.employerBySite++
      return { ...p, companyDomain: found.domain }
    }
    tally.noCompany++
    return { ...p, noCompany: true }
  })

  // Mark people at companies known to accept every address, to take no
  // email at all, or whose mail server wouldn't answer our test. The page
  // decides whether to hide them (it does while verified-only is on).
  const known = (d: string) => db.getEmailDomain(d)
  const markKnown = () => {
    const now = Date.now()
    for (const p of items) {
      if (!p.companyDomain || p.catchAll || p.noMail || p.noAnswer) continue
      if (isKnownCatchAll(p.companyDomain, known, now)) p.catchAll = !worthIt(p.companyDomain)
      else if (isKnownNoMail(p.companyDomain, known, now)) p.noMail = true
      else if (isKnownSilent(p.companyDomain, known, now)) p.noAnswer = !worthIt(p.companyDomain)
    }
  }
  markKnown()
  // In a hosted copy, also companies any other copy there has found out
  // about (sharedCatchAll.ts): company refs and domains only.
  const unmarked = items.filter((p) => !p.catchAll && !(p.companyDomain && worthIt(p.companyDomain)))
  const shared = await sharedCatchAllVerdicts(unmarked.map((p) => ({ ref: p.companyRef, domain: p.companyDomain })))
  unmarked.forEach((p, i) => {
    keepSharedVerdict(db, p.companyDomain, shared[i])
    if (shared[i]?.catchAll === true) p.catchAll = true
  })
  // Where such people are hidden, the batch waits a little for the tests of
  // the domains nobody had tested yet, so that nobody is shown someone a
  // Reveal can't work for.
  if (tests) {
    const untested = [
      ...new Set(
        items
          .filter((p) => p.companyDomain && !p.catchAll && !p.noMail && !p.noAnswer && p.previously !== 'saved' && !worthIt(p.companyDomain))
          .map((p) => p.companyDomain!.toLowerCase().trim()),
      ),
    ]
    const answered = await tests.settle(untested)
    tally.domainsChecked += answered
    tally.domainsUnchecked += untested.length - answered
    markKnown()
  }
  // What was known of each one's mail domain as they were shown (company data): an email
  // format learned there, tested and not accepting every address, known to accept every
  // address, take no email or not answer, or not tested yet.
  {
    const now = Date.now()
    for (const p of items) {
      if (!p.companyDomain) continue
      const rec = known(p.companyDomain.toLowerCase().trim())
      p.companySize ??= (p.companyRef ? bucketOf(db.getProspectCompany(p.companyRef)?.headcount) : null) ?? undefined
      p.mailCheck = trustedPattern(rec, now)
        ? 'pattern'
        : p.catchAll || p.noMail || p.noAnswer || rec?.catch_all === true || rec?.accepts_mail === false
          ? 'deadEnd'
          : rec?.catch_all === false
            ? 'tested'
            : 'untested'
    }
  }

  // Signals (signals.ts): new in role from the profile, and warm from the
  // workspace's own engagement, the person's own for someone already a contact.
  const warm = warmIndex(db.data)
  items = items.map((p) => {
    if (p.roleStartedOn) p.roleStartedOn.length > 4 ? tally.roleStartMonth++ : tally.roleStartYear++
    const own = p.previously === 'saved' && p.email ? warm.byEmail.get(p.email.toLowerCase()) : undefined
    return withSignals(p, [newInRoleSignal(p.roleStartedOn), own ? warmSignal(own, true) : warmFor(warm, { domain: p.companyDomain, ref: p.companyRef })])
  })

  const shown = new Set(items.map((p) => p.profileUrl))
  return {
    items,
    refined,
    lookupError,
    // Those not confirmed cost nothing.
    lookedUp: toLookUp.filter((p) => !notRead.has(p.profileUrl)).map((p) => p.profileUrl),
    shared: [...fromShared].filter((url) => shown.has(url)).length,
    spared: spared.length,
    unconfirmed,
  }
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
  const { remaining, requireAllowance } = await import('../allowance')
  const { company, includeContacts = false, fromStart = false, ...filters } = input
  // Whether a job title is one searched for, for choosing between someone's current jobs (refine.ts).
  const titleFits = filters.titles?.length ? fitsTitles(filters.titles) : undefined
  // Only people with one of these signals (signals.ts). Warm chooses the companies first, from the workspace's own.
  const kinds: SignalKind[] = filters.signals ?? []
  const warmFirst = !company && kinds.includes('warm')
  // Hiring and funding are about a company: the companies are found first, and kept only with one.
  const webFirst = !company && !warmFirst && kinds.some((k) => (WEB_SIGNAL_KINDS as readonly SignalKind[]).includes(k))
  const companyFirst = !company && (Boolean(filters.companySizes?.length) || warmFirst || webFirst)
  if (companyFirst && !warmFirst && !companyTerms(filters).length) throw new Error(filters.companySizes?.length ? SIZE_NEEDS_TERM : SIGNALS_NEED_TERM)
  // With company filters (size, industry, signals), or inside one company, SocialFetch's own search, which
  // knows who works where; by job title alone, the web's where it's on (runtime.ts getSource). A web search
  // can't tell an industry at all.
  const source: Source = getSource({ companies: companyFirst || Boolean(company) || Boolean(filters.industries?.length) })
  // People whose email can't be verified are hidden, unless the user chose
  // to see them marked as such (Settings → Prospect search).
  const hideUnverifiable = isVerifiedOnly() && hidesUnverifiable()
  const hidden = (p: PersonResult) => hideUnverifiable && Boolean(p.catchAll || p.noMail || p.noAnswer || p.noCompany)
  // Where the host's profile lookups are free, everyone is looked up, and in a
  // companies-first search someone working elsewhere is kept if that fits.
  const { profileLookupsFree } = await import('./hostRules')
  const free = profileLookupsFree() ? { fits: companyFirst ? (c: CompanyResult) => fitsFilters(c, filters) : null } : undefined
  // Batches searched once with no job title (searchedWithoutTitle).
  let noTitleSearches = 0
  // A plan's prospect credits: less than one left stops here, before anything is paid for.
  const left = remaining('prospects')
  if (left < 1) requireAllowance('prospects')

  // Results per page is the people on the page, whatever the number of job
  // titles: each title is its own search, and they share the page between
  // them (a request is sized to what's still needed, split across the titles).
  const titles = new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean)).size
  const slots = Math.min(MAX_TITLES_SEARCHED, Math.max(1, titles))
  const asked = Math.min(PAGE_SIZES[PAGE_SIZES.length - 1], Math.max(1, filters.count ?? PAGE_SIZES[0]))
  // A credit per person shown, so a page asks for no more than are left.
  const target = Math.min(asked, Math.floor(left))
  // Searches the page takes before any top-up: over 50 a title needs two.
  const planned = Math.ceil(Math.ceil(target / slots) / MAX_PER_REQUEST)
  // Paid requests one of those searches takes: one per job title searched (several leadership
  // titles can share one). The page's limits count paid requests, people and company searches
  // alike, so a search served from held results (searchPool.ts) doesn't use one up.
  const perSearch = searchesForTitles(filters.titles, { small: onlySmallCompanies(filters.companySizes) })
  const capFor = (searchesAllowed: number) => searchesAllowed * perSearch
  // A hard stop on searches however little they cost, and with lookups free, on profiles read.
  // A source can take more top-ups than SocialFetch's credits allow (webSource.ts).
  const maxTopUps = source.maxTopUps ?? MAX_TOP_UPS
  const MAX_SEARCHES = 3 * (planned + maxTopUps)
  const maxReads = 3 * target

  const items: PersonResult[] = []
  const refined: string[] = []
  const seen = new Set<string>()
  const warnings: string[] = []
  const details: string[] = []
  const tally: Tally = {
    noSurname: 0, alreadySaved: 0, inContacts: 0, failed: 0, noJob: 0, unconfirmed: 0, wrongCompany: 0, remembered: 0,
    paidInContacts: 0, skippedUnverifiable: 0, skippedNotWorking: 0, skippedContact: 0, skippedOtherEmployer: 0, noLookup: 0,
    employerByName: 0, employerByGuess: 0, employerBySite: 0, noCompany: 0, domainsChecked: 0, domainsUnchecked: 0, companyPagesRead: 0, noWebsite: 0, noSignal: 0, otherJob: 0, otherJobRefused: 0, roleStartMonth: 0, roleStartYear: 0,
    wrongCompanySameSlug: 0, siteLookupFailed: 0, employerFromListing: 0,
  }
  // Hidden people don't fill the page.
  const usable = () => items.filter((p) => !hidden(p)).length
  // A batch can find a few more people than the page has room left for (each
  // title's search is asked for a share of what's needed, rounded up): the
  // page takes the first of them and stops at the number asked for.
  // The signals filter: people with none of the signals asked for are left out, and counted.
  const withSignalsAsked = (found: PersonResult[]) => {
    if (!kinds.length) return found
    const kept = found.filter((p) => hasSignal(p, kinds))
    tally.noSignal += found.length - kept.length
    return kept
  }
  const fitting = (found: PersonResult[], opts: { findableFirst?: boolean } = {}) => {
    let room = target - usable()
    if (!opts.findableFirst) return found.filter((p) => hidden(p) || room-- > 0)
    // Who takes the room is chosen by how findable their email is; they stay in the order found.
    const chosen = new Set(findableFirst(found.filter((p) => !hidden(p))).slice(0, Math.max(0, room)).map((p) => p.profileUrl))
    return found.filter((p) => hidden(p) || chosen.has(p.profileUrl))
  }

  // A new search carries on from where the last one with these filters
  // stopped, so the same first pages aren't paid for and shown again.
  const positionKey = searchPositionKey(input)
  const saved = !filters.cursor && !fromStart ? db.getSearchPosition(positionKey) : null
  let cursor = filters.cursor ?? saved ?? undefined
  // Carrying on (Load more, or where the last search stopped): nobody it already showed is shown again.
  const shownHashes = shownFor(positionKey, Boolean(cursor))
  const hashOf = (p: PersonResult) => profileHash(p.profileUrl) ?? p.profileUrl
  let nextCursor: string | null = null
  let reportedTotal: number | null = null
  let searches = 0
  // Paid people-search requests: a page served from held results (searchPool.ts) costs none.
  let requests = 0
  let lookupError: string | undefined
  let lookedUp = 0
  // People whose job and employer came from the host's shared database, and how many profile lookups that spared.
  let shared = 0
  let spared = 0
  const paidFor = new Set<string>()
  let wasteful = false
  /** Why the page stopped searching, for the search log: full, nothing more, most top-ups, few kept, budget, or a failure. */
  let stop = 'failure'
  let orgSearches = 0
  let companiesFound = 0
  // Set when the data source failed partway: the page keeps what it had found.
  let interrupted = false
  // People whose profile couldn't be confirmed (ProfileUnconfirmed), with the
  // companies their batch searched: asked about again if the page runs short.
  let heldBack: Array<{ person: PersonResult; companySet?: Map<string, string> }> = []
  // People in a related role, not a title searched (relatedRoles): they fill the page only if it ends short.
  const relatedHeld: Array<{ person: PersonResult; companySet?: Map<string, string> }> = []
  let relatedShown = 0
  // Set when a whole batch of profiles couldn't be confirmed: more searching wouldn't confirm any either.
  let cantConfirm = false
  // Companies left out before searching people there (screenCompanies).
  const screened = { unverifiable: 0, noDomain: 0, noWebsite: 0 }
  // How many companies match the filters in all, as SocialFetch counts them (up to 1,000).
  const org: { total: number | null } = { total: null }
  // What became of the people the searches returned, for the funnel log.
  const funnel = { hits: 0, offTitle: 0, filteredOut: 0, repeats: 0 }
  // For the search log (searchLog.ts): which search showed each person, and how long it took.
  const searchId = newSearchId()
  const startedAt = Date.now()
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
    screened: { unverifiable: number; noDomain: number; noWebsite: number }
    /** Hiring and funding filters: the signals of the companies searched, by ref. */
    signals?: Map<string, Signal[]>
    firstOfBatch?: boolean
  }
  // Hiring and funding filters: companies left out, and put back to wait, over the page,
  // and the signals of those searched, for the people found there.
  const signalTally = { noSignal: 0, waiting: 0 }
  const companySignalsByRef = new Map<string, Signal[]>()
  const withCompanySignals = (found: PersonResult[]) =>
    companySignalsByRef.size ? found.map((p) => (p.companyRef && companySignalsByRef.has(p.companyRef) ? withSignals(p, companySignalsByRef.get(p.companyRef)!) : p)) : found
  const fetchPage = async (at: string | undefined, count: number, need: number): Promise<Fetched> => {
    const sc = { unverifiable: 0, noDomain: 0, noWebsite: 0 }
    if (!companyFirst) {
      const page = await source.searchPeople(company ?? null, { ...filters, cursor: at, count })
      return { page, splitCursor: null, batchHasMore: false, orgSearches: 0, found: 0, orgTotal: null, screened: sc }
    }
    const r = await companyFirstPage(source, db, filters, at, count, need, hideUnverifiable ? sc : undefined, signalTally)
    return { page: r.page, companySet: r.companies, splitCursor: r.splitCursor, batchHasMore: r.batchHasMore, orgSearches: r.orgSearches, found: r.found, orgTotal: r.orgTotal, screened: sc, signals: r.signals, firstOfBatch: r.firstOfBatch }
  }
  // The next search page, started while this one's profiles are looked up
  // (only when the page certainly needs it), and any started but not used:
  // their credits are counted before the search ends, and their people are
  // held (searchPool.ts) for Load more.
  let ahead: { cursor: string; fetched: Promise<Fetched> } | null = null
  const unused: Promise<unknown>[] = []
  const dropAhead = () => {
    if (!ahead) return
    prefetch.dropped++
    unused.push(ahead.fetched.then((r) => ((requests += r.page.requests ?? 1), (orgSearches += r.orgSearches)), () => {}))
    ahead = null
  }
  // What a full page normally costs: its searches and a profile lookup per person.
  const pageBudget = planned * 3 + target * 3
  // Paid requests so far, and why the page would stop now that it has had its share (null: it carries on).
  const paid = () => requests + orgSearches
  const capped = (spent: () => number): string | null =>
    paid() >= capFor(planned + maxTopUps) || searches >= MAX_SEARCHES
      ? 'most top-ups'
      : free && lookedUp >= maxReads
        ? 'most reads'
        : paid() >= capFor(planned + TOP_UPS) && spent() >= pageBudget
          ? 'budget'
          : null
  // Set when the page has had its share but a search started ahead was already paid for: that
  // one is used (not thrown away and paid for again on Load more), and then the page stops.
  let finishing: string | null = null
  // Search pages started ahead and used, or dropped unused.
  const prefetch = { used: 0, dropped: 0 }
  // Companies-first: batches searched, the companies in them, and those of fewer than 10.
  const batches = { searched: 0, companies: 0, small: 0 }
  // From each page's own counts (socialfetch.ts): people counted once, empty requests, and so on.
  const once = { hits: 0, offTitle: 0, empty: 0, joinerRetries: 0, webPages: 0, webTries: 0, webPaid: 0 }
  const onlyByTitle: number[] = []
  await meterCredits(async (spent) => {
    for (;;) {
      const need = target - usable()
      const count = Math.min(MAX_PER_REQUEST, Math.max(1, Math.ceil(need / slots)))
      let r: Fetched
      try {
        if (ahead && ahead.cursor === cursor) {
          const { fetched } = ahead
          ahead = null
          prefetch.used++
          r = await fetched
        } else {
          dropAhead()
          r = await fetchPage(cursor, count, need)
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
      r.signals?.forEach((signals, ref) => companySignalsByRef.set(ref, signals))
      let splitWhen: ((toLookUp: number) => boolean) | undefined
      // Searching companies one at a time saves lookups, which are nothing to save when free.
      if (splitCursor && !free) {
        // A batch with more people than this page is likely to need more lookups than it shows.
        const batchSize = r.companySet?.size ?? 0
        const more = r.batchHasMore
        splitWhen = (toLookUp) => toLookUp * (more ? 2 : 1) > batchSize * searchesForTitles(filters.titles, { small: onlySmallCompanies(filters.companySizes) })
      }
      orgSearches += r.orgSearches
      companiesFound += r.found
      screened.unverifiable += r.screened.unverifiable
      screened.noDomain += r.screened.noDomain
      screened.noWebsite += r.screened.noWebsite
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
      const unseen = page.items.filter((p) => !seen.has(p.profileUrl) && !shownHashes.has(hashOf(p)))
      // A companies-first search for one size: everyone found is at a company that size.
      if (companyFirst && filters.companySizes?.length === 1) for (const p of unseen) p.companySize ??= filters.companySizes[0]
      // People in a related role, not a title searched: held back to fill the page if it ends short.
      const fresh = unseen.filter((p) => !p.related)
      for (const person of unseen) if (person.related) relatedHeld.push({ person, companySet })

      // Even with everyone here shown the page won't be full, so the next
      // search page starts now rather than after these profiles are looked up.
      // Not when the page has had its share, or when this search's own cost would end it.
      const certain =
        nextCursor &&
        !finishing &&
        usable() + fresh.length < target &&
        paid() + perSearch <= capFor(planned + maxTopUps) &&
        searches + 1 < MAX_SEARCHES &&
        !(free && lookedUp >= maxReads) &&
        !(paid() + perSearch >= capFor(planned + TOP_UPS) && spent() + perSearch * 3 >= pageBudget)
      if (certain) {
        // Sized for what's still needed if everyone here is shown.
        const fetched = fetchPage(nextCursor!, Math.min(MAX_PER_REQUEST, Math.max(1, Math.ceil((need - fresh.length) / slots))), Math.max(1, need - fresh.length))
        fetched.catch(() => {})
        ahead = { cursor: nextCursor!, fetched }
      }

      const batch = await processBatch(fresh, company ?? null, source, db, tally, hideUnverifiable, includeContacts, companySet, splitWhen, free, titleFits)
      // Batches of companies as they were filled: each once, unless it was split to search its companies one at a time.
      if (r.firstOfBatch && companySet?.size && !(batch.split && splitCursor)) {
        batches.searched++
        batches.companies += companySet.size
        if (companySet.size < 10) batches.small++
        if (page.funnel?.noTitle) noTitleSearches++
      }
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
      funnel.repeats += page.items.length - unseen.length
      once.hits += page.funnel?.uniqueHits ?? page.funnel?.hits ?? page.items.length
      once.offTitle += page.funnel?.uniqueOffTitle ?? page.funnel?.offTitle ?? 0
      once.empty += page.funnel?.emptyRequests ?? 0
      once.joinerRetries += page.funnel?.joinerRetries ?? 0
      once.webPages += page.funnel?.webPages ?? 0
      once.webTries += page.funnel?.webTries ?? 0
      once.webPaid += page.funnel?.webPaid ?? 0
      page.funnel?.onlyByTitle?.forEach((n, i) => (onlyByTitle[i] = (onlyByTitle[i] ?? 0) + n))
      unseen.forEach((p) => seen.add(p.profileUrl))
      for (const p of batch.items) p.searchId = searchId
      // When there's less room than people, those whose email is likeliest to be found take it (mailCheck).
      const taken = fitting(withSignalsAsked(withCompanySignals(batch.items)), { findableFirst: true })
      const takenRefined = batch.refined.filter((url) => taken.some((p) => p.profileUrl === url))
      items.push(...taken)
      refined.push(...takenRefined)
      if (taken.length) opts.onPeople?.({ items: taken, refined: takenRefined })
      lookedUp += batch.lookedUp.length
      shared += batch.shared
      spared += batch.spared
      batch.lookedUp.forEach((url) => paidFor.add(url))
      heldBack.push(...batch.unconfirmed.map((person) => ({ person, companySet })))
      if (batch.lookupError) {
        lookupError = batch.lookupError
        break
      }
      if (batch.unconfirmed.length >= MIN_LOOKUPS_TO_JUDGE && batch.lookedUp.length === 0) {
        cantConfirm = true
        break
      }
      if (usable() >= target) {
        stop = 'full'
        break
      }
      if (!nextCursor) {
        stop = 'nothing more'
        break
      }
      if (finishing) {
        stop = finishing
        break
      }
      if (!free && searches >= planned && lookedUp >= MIN_LOOKUPS_TO_JUDGE && usable() / lookedUp < MIN_KEPT_SHARE) {
        wasteful = true
        stop = 'few kept'
        break
      }
      const reason = capped(spent)
      if (reason) {
        // The next search was started ahead and paid for: it's used, then the page stops.
        if (ahead && ahead.cursor === nextCursor) finishing = reason
        else {
          stop = reason
          break
        }
      }
      cursor = nextCursor
    }

    // Short of a full page: those whose profile couldn't be confirmed are
    // asked about once more. LinkedIn sometimes turns away a profile it would
    // show a moment later; one hidden from anyone not signed in stays hidden.
    if (heldBack.length && usable() < target && !lookupError && !interrupted && !cantConfirm) {
      const groups = new Map<Map<string, string> | undefined, PersonResult[]>()
      for (const { person, companySet } of heldBack) groups.set(companySet, [...(groups.get(companySet) ?? []), person])
      heldBack = []
      for (const [companySet, people] of groups) {
        const batch = await processBatch(people, company ?? null, source, db, tally, hideUnverifiable, includeContacts, companySet, undefined, free, titleFits)
        for (const p of batch.items) p.searchId = searchId
        const taken = fitting(withSignalsAsked(withCompanySignals(batch.items)))
        const takenRefined = batch.refined.filter((url) => taken.some((p) => p.profileUrl === url))
        items.push(...taken)
        refined.push(...takenRefined)
        if (taken.length) opts.onPeople?.({ items: taken, refined: takenRefined })
        lookedUp += batch.lookedUp.length
        shared += batch.shared
        spared += batch.spared
        batch.lookedUp.forEach((url) => paidFor.add(url))
        heldBack.push(...batch.unconfirmed.map((person) => ({ person, companySet })))
        if (batch.lookupError) {
          lookupError = batch.lookupError
          break
        }
      }
    }
    // Still short: people in related roles in the same department fill it, after everyone with a
    // title searched and marked as such. Only as many are looked up as there could be room for.
    if (filters.relatedRoles !== false && relatedHeld.length && usable() < target && !lookupError && !interrupted && !cantConfirm) {
      const groups = new Map<Map<string, string> | undefined, PersonResult[]>()
      for (const { person, companySet } of relatedHeld.slice(0, (target - usable()) * 2 + 5)) groups.set(companySet, [...(groups.get(companySet) ?? []), person])
      for (const [companySet, people] of groups) {
        if (usable() >= target) break
        const batch = await processBatch(people, company ?? null, source, db, tally, hideUnverifiable, includeContacts, companySet, undefined, free, titleFits)
        for (const p of batch.items) p.searchId = searchId
        const taken = fitting(withSignalsAsked(withCompanySignals(batch.items)))
        const takenRefined = batch.refined.filter((url) => taken.some((p) => p.profileUrl === url))
        items.push(...taken)
        refined.push(...takenRefined)
        relatedShown += taken.filter((p) => !hidden(p)).length
        if (taken.length) opts.onPeople?.({ items: taken, refined: takenRefined })
        lookedUp += batch.lookedUp.length
        batch.lookedUp.forEach((url) => paidFor.add(url))
        if (batch.lookupError) {
          lookupError = batch.lookupError
          break
        }
      }
    }
    tally.unconfirmed = heldBack.length
    dropAhead()
    await Promise.allSettled(unused)
  })

  // Where to carry on next time; at the end of the results, back to the top.
  if (!lookupError) db.setSearchPosition(positionKey, nextCursor)
  for (const p of items) shownHashes.add(hashOf(p))
  if (nextCursor) keepShown(positionKey, shownHashes)
  else shownBefore.delete(positionKey)

  // Where the people it returned went. Filters and counts only, nothing personal:
  // one line in the log, and one in the search log a host can read (searchLog.ts).
  const page = filters.cursor ? 'more' : saved ? 'resumed' : 'first'
  const hiddenPeople = items.filter(hidden)
  const counts = {
    companiesFirst: companyFirst,
    orgSearches,
    companiesFound,
    companiesInAll: org.total,
    companiesLeftOut: screened.unverifiable,
    companiesNoWebsite: screened.noWebsite,
    batchesSplit: split.batches,
    companiesSearchedAlone: split.companies,
    peopleSearches: requests,
    searchesRun: searches,
    emptySearches: once.empty,
    joinerRetries: once.joinerRetries,
    ...(once.webTries ? { webPages: once.webPages, webTries: once.webTries, webPaid: once.webPaid } : {}),
    batchesSearched: batches.searched,
    noTitleBatches: noTitleSearches,
    companiesInBatches: batches.companies,
    smallBatches: batches.small,
    prefetchUsed: prefetch.used,
    prefetchDropped: prefetch.dropped,
    hits: funnel.hits,
    offTitle: funnel.offTitle,
    uniqueHits: once.hits,
    uniqueOffTitle: once.offTitle,
    ...Object.fromEntries(onlyByTitle.map((n, i) => [`onlyByTitle_${i}`, n])),
    seniorityOrCountry: funnel.filteredOut,
    repeats: funnel.repeats,
    headlineLeft: tally.skippedNotWorking,
    headlineOtherEmployer: tally.skippedOtherEmployer,
    inContacts: tally.inContacts,
    paidInContacts: tally.paidInContacts,
    noSurname: tally.noSurname,
    knownUnverifiable: tally.skippedUnverifiable,
    noLookupNeeded: tally.noLookup,
    profilesBought: lookedUp,
    boughtWrongCompany: tally.wrongCompany,
    wrongCompanySameSlug: tally.wrongCompanySameSlug,
    boughtNoJob: tally.noJob,
    profileUnconfirmed: tally.unconfirmed,
    employerFromListing: tally.employerFromListing,
    employerByName: tally.employerByName,
    employerByPageGuess: tally.employerByGuess,
    employerByWebSearch: tally.employerBySite,
    noCompanyPage: tally.noCompany,
    companyPagesRead: tally.companyPagesRead,
    noWebsite: tally.noWebsite,
    siteLookupFailed: tally.siteLookupFailed,
    domainsCheckedAhead: tally.domainsChecked,
    domainsNotChecked: tally.domainsUnchecked,
    mailServerSilent: items.filter((p) => p.noAnswer).length,
    hiddenUnverifiable: items.filter(hidden).length,
    shown: usable(),
    fromSharedDatabase: shared,
    lookupsSpared: spared,
    prospectCredits: usable(),
    noSignal: tally.noSignal,
    relatedFound: relatedHeld.length,
    relatedShown,
    otherJobTaken: tally.otherJob,
    otherJobRefused: tally.otherJobRefused,
    companiesNoSignal: signalTally.noSignal,
    companiesSignalWaiting: signalTally.waiting,
    signalHiring: items.filter((p) => p.signals?.some((x) => x.kind === 'hiring')).length,
    signalFunding: items.filter((p) => p.signals?.some((x) => x.kind === 'funding')).length,
    signalWarm: items.filter((p) => p.signals?.some((x) => x.kind === 'warm')).length,
    signalNewInRole: items.filter((p) => p.signals?.some((x) => x.kind === 'new_in_role')).length,
    roleStartMonth: tally.roleStartMonth,
    roleStartYear: tally.roleStartYear,
  }
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
        signals: kinds.length ? kinds : undefined,
        page,
      },
      stop: interrupted ? 'source failed' : lookupError ? 'lookup failed' : cantConfirm ? 'profiles unreadable' : stop,
      ...counts,
    })}`,
  )
  await logSearch({
    id: searchId,
    at: new Date().toISOString(),
    ms: Date.now() - startedAt,
    filters: {
      titles: filters.titles ?? [],
      seniorities: filters.seniorities ?? [],
      industries: filters.industries ?? [],
      sizes: filters.companySizes ?? [],
      country: filters.country?.trim() || null,
      company: company?.name ?? null,
      keyword: Boolean(filters.keyword?.trim()),
      ...(kinds.length ? { signals: kinds } : {}),
      page,
    },
    counts: Object.fromEntries(Object.entries(counts).filter((e): e is [string, number] => typeof e[1] === 'number')),
    stop: interrupted ? 'source failed' : lookupError ? 'lookup failed' : cantConfirm ? 'profiles unreadable' : stop,
  })

  // A prospect credit for each person shown; what finding them took isn't charged.
  const { recordUsage } = await import('../usage')
  recordUsage({
    searches: requests + orgSearches,
    prospects: usable(),
    prospectCredits: usable(),
    sharedPeople: shared,
    searchProfiles: lookedUp,
    searchHits: funnel.hits - funnel.repeats,
    searchShown: usable(),
    searchOffTitle: funnel.offTitle,
    searchUnconfirmed: tally.unconfirmed,
    searchNoJob: tally.noJob,
    // Someone with no current job has no company either: counted once, as no job.
    searchNoSite: Math.max(0, hiddenPeople.filter((p) => p.noCompany).length - tally.noJob),
    searchDeadDomain: hiddenPeople.filter((p) => !p.noCompany).length,
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
  if (tally.noSignal > 0) {
    details.push(`${plural(tally.noSignal, 'person was', 'people were')} left out for having none of the signals chosen.`)
  }
  if (relatedShown > 0) {
    details.push(
      `Too few people here have the job titles searched, so ${plural(relatedShown, 'person', 'people')} in related roles in the same department ${relatedShown === 1 ? 'follows' : 'follow'} them, marked "Related role".`,
    )
  }
  if (signalTally.noSignal > 0) {
    details.push(`${plural(signalTally.noSignal, 'company was', 'companies were')} passed over for showing none of the signals chosen, before anyone there was searched for.`)
  }
  if (warmFirst) {
    // Warm companies known only by their domain can't be searched inside: say how many.
    const noRef = warmWithoutRef(warmIndex(db.data))
    details.push(
      companiesFound
        ? `Searched inside your warm companies: ${plural(companiesFound, 'company', 'companies')} where your emails, forms or proposals found interest in the last 90 days.${noRef ? ` ${plural(noRef, 'other has', 'others have')} no LinkedIn company page we know, so couldn't be searched.` : ''}`
        : `None of your warm companies has a LinkedIn company page we know, so there's nowhere to search${noRef ? ` (${plural(noRef, 'warm company', 'warm companies')} known only by email domain)` : ''}. Saving people from prospect search links their companies.`,
    )
  } else if (companyFirst && companiesFound) {
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
  if (tally.noJob > 0) {
    details.push(
      `${plural(tally.noJob, 'profile has', 'profiles have')} no current job listed${hideUnverifiable ? ', so there is no company to find an email at.' : '; showing the headline instead.'}`,
    )
  }
  if (tally.noCompany > tally.noJob) {
    const n = tally.noCompany - tally.noJob
    details.push(`${plural(n, "person's profile doesn't", "people's profiles don't")} link their employer's company page, so there's no website to find an email on.`)
  }
  if (tally.noWebsite > 0) {
    details.push(`${plural(tally.noWebsite, 'person works', 'people work')} at a company whose LinkedIn page lists no website, and none could be found, so there's nowhere to find an email.`)
  }
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
  if (target < asked) {
    warnings.push(`Your plan has ${plural(Math.floor(left), 'prospect credit', 'prospect credits')} left this month, so this page shows at most that many people. Upgrade to get more.`)
  }
  if (wasteful) warnings.push(wastefulWarning(tally, items.length - usable(), lookedUp, company?.name))
  if (cantConfirm) {
    warnings.push(`Profiles can't be checked right now, so this page stopped at ${usable()} of the ${target} asked for. Load more in a few minutes to carry on.`)
  } else if (interrupted) {
    // A warning: a hosted copy shows it too, as it says what to do.
    warnings.push(`The people data source is busy right now, so this page stopped at ${usable()} of the ${target} asked for. Load more in a minute to carry on.`)
  } else if (!lookupError && usable() < target && nextCursor && !wasteful) {
    details.push(`Found ${usable()} of ${target} after ${plural(searches, 'search', 'searches')}. Load more to keep looking.`)
  } else if (!lookupError && usable() < target && companyFirst && !nextCursor && !wasteful && warmFirst) {
    warnings.push(`That's everyone at your warm companies: ${plural(usable(), 'person', 'people')} of the ${target} asked for. More job titles, or fewer filters, find more there.`)
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
    [tally.noSignal, 'Having none of the signals chosen', 'Fewer signals, or none, finds more people.'],
  ]
  const [n, why, next] = reasons.sort((a, b) => b[0] - a[0])[0]
  const left = n > 0 ? `${why} left out ${n} of the ${lookedUp} people whose profiles were checked` : `Most of the ${lookedUp} people whose profiles were checked were left out`
  return `${left}, so no more pages were searched, to save credits. ${n > 0 ? next : 'Try broader filters.'} Load more carries on if you want to keep looking.`
}

/** The same filters give the same key, whatever order titles or options were picked in. */
/**
 * Who a search with these filters has shown in the last hour, by the keyed
 * hash of their profile link (suppression.ts; never the link), so someone
 * found again on a later page, by another job title's request, isn't shown or
 * charged twice. In memory only, for at most MAX_SHOWN_SEARCHES searches.
 */
const SHOWN_TTL_MS = 3_600_000
const MAX_SHOWN_SEARCHES = 200
const shownBefore = new Map<string, { at: number; hashes: Set<string> }>()

function shownFor(positionKey: string, carriesOn: boolean): Set<string> {
  const held = shownBefore.get(positionKey)
  return carriesOn && held && Date.now() - held.at < SHOWN_TTL_MS ? held.hashes : new Set()
}

function keepShown(positionKey: string, hashes: Set<string>) {
  shownBefore.delete(positionKey)
  shownBefore.set(positionKey, { at: Date.now(), hashes })
  for (const [key, held] of shownBefore) if (Date.now() - held.at >= SHOWN_TTL_MS) shownBefore.delete(key)
  while (shownBefore.size > MAX_SHOWN_SEARCHES) shownBefore.delete(shownBefore.keys().next().value!)
}

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
    // Only when switched off, so searches from before keep their place.
    ...(input.relatedRoles === false ? { relatedRoles: false } : {}),
    // Only when used, so searches from before signals keep their place.
    ...(input.signals?.length ? { signals: sorted(input.signals) } : {}),
  })
  return createHash('sha256').update(key).digest('base64url').slice(0, 32)
}

export async function startSave(listId: number, people: PersonResult[]) {
  const { db } = await import('../db')
  if (!db.data.lists.some((l) => l.id === listId)) throw new Error(`List ${listId} does not exist`)
  const { getSource, getFinderDeps } = await import('./runtime')
  const { saveProspects } = await import('./save')
  const { allowsFormatConfirmed, isVerifiedOnly } = await import('./settings')
  const { contribute, sharedEmail } = await import('./sharedPeople')
  const { sharedDatabase } = await import('./hostRules')
  return saveProspects(listId, people, {
    source: getSource(),
    finder: await getFinderDeps({ background: true }),
    db,
    verifiedOnly: isVerifiedOnly(),
    allowFormatConfirmed: allowsFormatConfirmed(),
    contribute,
    sharedEmail,
    sharedFree: Boolean(sharedDatabase()?.contributing),
  })
}
