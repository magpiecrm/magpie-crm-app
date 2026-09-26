// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import type { CompanyFilters, CompanyResult, Page, PeopleFilters, PeopleSource, PersonResult } from './types'
import { isKnownCatchAll, surnameHidden } from './emailFinder'
import { sameCompanyName, slugFromCompanyUrl } from './socialfetch'
import { classifySeniority } from './seniority'
import { emailHash, hashesFor, isSuppressed, profileHash } from './suppression'

export async function searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const page = await getSource().searchCompanies(filters)

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
  return page
}

/** Company with a known domain where possible; fetches the company page once if needed. */
export async function resolveCompany(ref: string): Promise<{ ref: string; domain: string | null; catchAll: boolean }> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { resolveCompanyDomain } = await import('./companies')
  const name = db.getProspectCompany(ref)?.name ?? ref
  const domain = await resolveCompanyDomain(ref, name, getSource(), db)
  return { ref, domain, catchAll: companyIsCatchAll(domain, db) }
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
  if (!profile?.companyRef) return { person: { ...person, profileChecked: true }, refined: false }
  return {
    refined: true,
    person: {
      ...person,
      profileChecked: true,
      title: profile.title || person.title,
      seniority: profile.seniority ?? person.seniority,
      company: profile.company || person.company,
      companyRef: profile.companyRef,
      companySlug: profile.companySlug ?? null,
      companyDomain: db.getProspectCompany(profile.companyRef)?.domain ?? null,
      country: person.country ?? profile.country,
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
  source: PeopleSource,
  db: Db,
  tally: Tally,
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

  // Mark people at companies already known to accept every address. The
  // page decides whether to hide them (it does while verified-only is on).
  // Only the cache is read: finding out about a new company would take an
  // SMTP check, and that waits until someone is actually revealed or saved.
  const now = Date.now()
  for (const p of items) {
    if (p.companyDomain && isKnownCatchAll(p.companyDomain, (d) => db.getEmailDomain(d), now)) p.catchAll = true
  }

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
  const { isVerifiedOnly } = await import('./settings')
  const { company, ...filters } = input
  const source = getSource()
  const verifiedOnly = isVerifiedOnly()

  // Results per page apply to each job title, as the search itself does.
  const titles = new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean)).size
  const slots = Math.min(MAX_TITLES_SEARCHED, Math.max(1, titles))
  const perSlot = filters.count ?? DEFAULT_PAGE_SIZE
  const target = perSlot * slots

  const items: PersonResult[] = []
  const refined: string[] = []
  const seen = new Set<string>()
  const warnings: string[] = []
  const tally: Tally = { noSurname: 0, alreadySaved: 0, failed: 0, noJob: 0, wrongCompany: 0 }
  // Catch-all people are hidden while verified-only is on, so they don't count.
  const usable = () => items.filter((p) => !(verifiedOnly && p.catchAll)).length

  let cursor = filters.cursor
  let nextCursor: string | null = null
  let reportedTotal: number | null = null
  let searches = 0
  let lookupError: string | undefined
  for (;;) {
    const need = target - usable()
    const page = await source.searchPeople(company ?? null, {
      ...filters,
      cursor,
      count: searches === 0 ? perSlot : Math.max(1, Math.ceil(need / slots)),
    })
    searches++
    // The first search's notes describe the whole query; later top-ups would repeat them.
    if (searches === 1) {
      reportedTotal = page.reportedTotal
      warnings.push(...page.warnings)
    }
    nextCursor = page.nextCursor
    const fresh = page.items.filter((p) => !seen.has(p.profileUrl))
    fresh.forEach((p) => seen.add(p.profileUrl))

    const batch = await processBatch(fresh, company ?? null, source, db, tally)
    items.push(...batch.items)
    refined.push(...batch.refined)
    if (batch.lookupError) {
      lookupError = batch.lookupError
      break
    }
    if (usable() >= target || !nextCursor || searches > MAX_TOP_UPS) break
    cursor = nextCursor
  }

  const { recordUsage } = await import('../usage')
  recordUsage({ searches, prospects: usable() })

  if (lookupError) warnings.push(`Couldn't look up profiles (${lookupError}), so titles and companies come from headlines.`)
  if (tally.noSurname > 0) {
    warnings.push(
      `${plural(tally.noSurname, 'person was', 'people were')} left out because LinkedIn hides ${tally.noSurname === 1 ? 'their surname' : 'their surnames'} (e.g. "Andy C."), so no email can be found.`,
    )
  }
  if (tally.failed > 0) warnings.push(`${plural(tally.failed, 'profile lookup', 'profile lookups')} failed (${tally.failedError}); showing the headline instead.`)
  if (tally.noJob > 0) warnings.push(`${plural(tally.noJob, 'profile has', 'profiles have')} no current job listed; showing the headline instead.`)
  if (tally.alreadySaved > 0) {
    warnings.push(`${plural(tally.alreadySaved, 'person is', 'people are')} already in your contacts, so their details come from there and no profile lookup was paid for.`)
  }
  if (company && tally.wrongCompany > 0) {
    warnings.push(`${plural(tally.wrongCompany, "person doesn't", "people don't")} currently work at ${company.name} and ${tally.wrongCompany === 1 ? 'was' : 'were'} left out.`)
  }
  if (searches > 1) {
    warnings.push(`Some results were left out, so ${plural(searches - 1, 'more search page was', 'more search pages were')} run to fill this page (3 credits each).`)
  }
  if (!lookupError && usable() < target && nextCursor) {
    warnings.push(`Found ${usable()} of ${target} after ${plural(searches, 'search', 'searches')}. Load more to keep looking.`)
  }

  return { items, nextCursor, reportedTotal, warnings, refined }
}

export async function startSave(listId: number, people: PersonResult[]) {
  const { db } = await import('../db')
  if (!db.data.lists.some((l) => l.id === listId)) throw new Error(`List ${listId} does not exist`)
  const { getSource, getFinderDeps } = await import('./runtime')
  const { saveProspects } = await import('./save')
  const { isVerifiedOnly } = await import('./settings')
  return saveProspects(listId, people, { source: getSource(), finder: await getFinderDeps({ background: true }), db, verifiedOnly: isVerifiedOnly() })
}
