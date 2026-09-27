// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import { env } from '../env'
import { refineFromProfile } from './refine'
import type { CompanyFilters, CompanyResult, CompanySource, HeadcountBucket, Page, PeopleFilters, PeopleSource, PersonResult } from './types'
import { isKnownCatchAll, surnameHidden } from './emailFinder'
import { sharedCatchAll } from './sharedCatchAll'
import { inHeadcountBuckets, meterCredits, sameCompanyName, slugFromCompanyUrl } from './socialfetch'
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
  for (const company of page.items) {
    if (company.domain && isKnownCatchAll(company.domain, (d) => db.getEmailDomain(d), now)) company.catchAll = true
  }
  // In a hosted copy, also those any other copy there has found out about.
  const unmarked = page.items.filter((c) => !c.catchAll)
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
  const catchAll = companyIsCatchAll(domain, db) || (await sharedCatchAll([{ ref, domain }]))[0]
  return { ref, domain, catchAll }
}

/** Whether a company's mail domain is already known to accept every address (cache only). */
export function companyIsCatchAll(domain: string | null, db: Db): boolean {
  return Boolean(domain && isKnownCatchAll(domain, (d) => db.getEmailDomain(d), Date.now()))
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

/** Extra search pages run to fill a page when results are left out (3 credits each). */
const MAX_TOP_UPS = 3
const DEFAULT_PAGE_SIZE = 25
const MAX_TITLES_SEARCHED = 5

/** What was left out or couldn't be looked up, added up across a page's searches. */
interface Tally {
  noSurname: number
  alreadySaved: number
  failed: number
  failedError?: string
  noJob: number
  wrongCompany: number
  wrongSize: number
}

type Source = PeopleSource & Partial<Pick<CompanySource, 'getCompany'>>

/**
 * A person's employer's headcount: from the company cache, else its company
 * page when the page name is known (1 credit, then cached for everyone; the
 * 6-9 credit lookup by id isn't worth it for a filter). Null if unknown.
 */
async function companyHeadcount(p: PersonResult, source: Source, db: Db): Promise<number | null> {
  if (!p.companyRef) return null
  const cached = db.getProspectCompany(p.companyRef)
  if (cached?.headcount != null) return cached.headcount
  const slug = p.companySlug ?? cached?.slug
  if (cached?.page_checked || !slug || !source.getCompany) return null
  const { resolveCompanyDomain } = await import('./companies')
  await resolveCompanyDomain(p.companyRef, p.company, { getCompany: source.getCompany }, db, slug).catch(() => null)
  return db.getProspectCompany(p.companyRef)?.headcount ?? null
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
  sizes?: HeadcountBucket[],
): Promise<{ items: PersonResult[]; refined: string[]; lookupError?: string }> {
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

  // A surname shown only as an initial ("Andy C.") means no address can be
  // worked out, so they're left out before any profile lookup is paid for.
  const withSurname = items.filter((p) => !surnameHidden(p.lastName))
  tally.noSurname += items.length - withSurname.length
  items = withSurname

  tally.alreadySaved += markPreviouslySeen(items, db)
  const toLookUp = items.filter((p) => p.previously !== 'saved')

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

  // With the real employer known, people who don't work at the chosen
  // company can be dropped.
  if (company) {
    const atCompany = items.filter(
      (p) => !refined.includes(p.profileUrl) || p.companyRef === company.ref || sameCompanyName(p.company, company.name),
    )
    tally.wrongCompany += items.length - atCompany.length
    items = atCompany
  }

  // With a company-size filter, each employer's size: from the company cache,
  // else its company page (1 credit, then cached). People at other sizes, or
  // whose employer's size can't be found, are left out.
  if (sizes?.length) {
    const refs = [...new Map(items.filter((p) => p.companyRef).map((p) => [p.companyRef!, p])).values()]
    const sizes_ = await mapLimit(refs, ENRICH_CONCURRENCY, async (p) => [p.companyRef!, await companyHeadcount(p, source, db)] as const)
    const sizeOf = new Map<string, number | null>(sizes_)
    const fits = items.filter((p) => {
      const size = p.companyRef ? sizeOf.get(p.companyRef) ?? null : null
      return size !== null && inHeadcountBuckets(size, sizes)
    })
    tally.wrongSize += items.length - fits.length
    items = fits
  }

  // Mark people at companies already known to accept every address. The
  // page decides whether to hide them (it does while verified-only is on).
  // Only the cache is read: finding out about a new company would take an
  // SMTP check, and that waits until someone is actually revealed or saved.
  const now = Date.now()
  for (const p of items) {
    if (p.companyDomain && isKnownCatchAll(p.companyDomain, (d) => db.getEmailDomain(d), now)) p.catchAll = true
  }
  // In a hosted copy, also companies any other copy there has found out
  // about (sharedCatchAll.ts): company refs and domains only.
  const unmarked = items.filter((p) => !p.catchAll)
  const shared = await sharedCatchAll(unmarked.map((p) => ({ ref: p.companyRef, domain: p.companyDomain })))
  unmarked.forEach((p, i) => shared[i] && (p.catchAll = true))

  return { items, refined, lookupError }
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
): Promise<Page<PersonResult> & { refined: string[] }> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { isVerifiedOnly, showsUnverifiable } = await import('./settings')
  const { prospectCredits, remaining, requireAllowance } = await import('../allowance')
  const { company, ...filters } = input
  const source = getSource()
  // People whose email can't be verified (their company accepts every
  // address) are hidden, unless the user chose to see them marked as such.
  const hidesCatchAll = isVerifiedOnly() && !showsUnverifiable()
  // A plan's prospect credits: less than one left stops here, before anything is paid for.
  const left = remaining('prospects')
  if (left < 1) requireAllowance('prospects')

  // Results per page apply to each job title, as the search itself does. A
  // hosted copy always searches full pages: the search's cost is then shared
  // by the most people, which is what a prospect credit is priced on.
  const titles = new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean)).size
  const slots = Math.min(MAX_TITLES_SEARCHED, Math.max(1, titles))
  const perSlot = env.prospectingManaged() ? DEFAULT_PAGE_SIZE : (filters.count ?? DEFAULT_PAGE_SIZE)
  // About one credit per person on a full page, so a page asks for no more than are left.
  const target = Math.min(perSlot * slots, Math.floor(left))

  const items: PersonResult[] = []
  const refined: string[] = []
  const seen = new Set<string>()
  const warnings: string[] = []
  const details: string[] = []
  const tally: Tally = { noSurname: 0, alreadySaved: 0, failed: 0, noJob: 0, wrongCompany: 0, wrongSize: 0 }
  // Hidden catch-all people don't fill the page or count as prospects.
  const usable = () => items.filter((p) => !(hidesCatchAll && p.catchAll)).length

  let cursor = filters.cursor
  let nextCursor: string | null = null
  let reportedTotal: number | null = null
  let searches = 0
  let lookupError: string | undefined
  const { credits } = await meterCredits(async (spent) => {
    for (;;) {
      const need = target - usable()
      const page = await source.searchPeople(company ?? null, {
        ...filters,
        cursor,
        count: searches === 0 ? Math.min(perSlot, Math.ceil(target / slots)) : Math.max(1, Math.ceil(need / slots)),
      })
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

      const batch = await processBatch(fresh, company ?? null, source, db, tally, company ? undefined : filters.companySizes)
      items.push(...batch.items)
      refined.push(...batch.refined)
      if (batch.lookupError) {
        lookupError = batch.lookupError
        break
      }
      if (usable() >= target || !nextCursor || searches > MAX_TOP_UPS) break
      // No top-up search once what's been spent uses up the credits left.
      if (prospectCredits(spent()) >= left) break
      cursor = nextCursor
    }
  })

  // Charged for what the searches cost, not for how many people are shown.
  const { recordUsage } = await import('../usage')
  recordUsage({ searches, prospects: usable(), prospectCredits: prospectCredits(credits) })

  if (lookupError) details.push(`Couldn't look up profiles (${lookupError}), so titles and companies come from headlines.`)
  if (tally.noSurname > 0) {
    details.push(
      `${plural(tally.noSurname, 'person was', 'people were')} left out because LinkedIn hides ${tally.noSurname === 1 ? 'their surname' : 'their surnames'} (e.g. "Andy C."), so no email can be found.`,
    )
  }
  if (tally.failed > 0) details.push(`${plural(tally.failed, 'profile lookup', 'profile lookups')} failed (${tally.failedError}); showing the headline instead.`)
  if (tally.noJob > 0) details.push(`${plural(tally.noJob, 'profile has', 'profiles have')} no current job listed; showing the headline instead.`)
  if (tally.alreadySaved > 0) {
    details.push(`${plural(tally.alreadySaved, 'person is', 'people are')} already in your contacts, so their details come from there and no profile lookup was paid for.`)
  }
  if (company && tally.wrongCompany > 0) {
    details.push(`${plural(tally.wrongCompany, "person doesn't", "people don't")} currently work at ${company.name} and ${tally.wrongCompany === 1 ? 'was' : 'were'} left out.`)
  }
  if (tally.wrongSize > 0) {
    details.push(`${plural(tally.wrongSize, "person's employer isn't", "people's employers aren't")} one of the chosen sizes, or couldn't be sized, and ${tally.wrongSize === 1 ? 'was' : 'were'} left out.`)
  }
  if (searches > 1) {
    details.push(`Some results were left out, so ${plural(searches - 1, 'more search page was', 'more search pages were')} run to fill this page (3 credits each).`)
  }
  if (target < perSlot * slots) {
    warnings.push(`Your plan has ${plural(Math.floor(left), 'prospect credit', 'prospect credits')} left this month, so this page asks for at most about that many people. Upgrade to get more.`)
  }
  if (!lookupError && usable() < target && nextCursor) {
    details.push(`Found ${usable()} of ${target} after ${plural(searches, 'search', 'searches')}. Load more to keep looking.`)
  }

  return { ...forThisCopy({ items, nextCursor, reportedTotal, warnings, details }), refined }
}

export async function startSave(listId: number, people: PersonResult[]) {
  const { db } = await import('../db')
  if (!db.data.lists.some((l) => l.id === listId)) throw new Error(`List ${listId} does not exist`)
  const { getSource, getFinderDeps } = await import('./runtime')
  const { saveProspects } = await import('./save')
  const { isVerifiedOnly } = await import('./settings')
  return saveProspects(listId, people, { source: getSource(), finder: await getFinderDeps({ background: true }), db, verifiedOnly: isVerifiedOnly() })
}
