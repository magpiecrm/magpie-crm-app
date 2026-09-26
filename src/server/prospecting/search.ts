// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import type { CompanyFilters, CompanyResult, Page, PeopleFilters, PeopleSource, PersonResult } from './types'
import { isKnownCatchAll } from './emailFinder'
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
export async function resolveCompany(ref: string): Promise<{ ref: string; domain: string | null }> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { resolveCompanyDomain } = await import('./companies')
  const name = db.getProspectCompany(ref)?.name ?? ref
  return { ref, domain: await resolveCompanyDomain(ref, name, getSource(), db) }
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

/**
 * People search. Search hits don't say where anyone works, and without an
 * employer there's no domain to find an email on, so every result's profile
 * is looked up (3 credits each) for their real current title and company.
 */
export async function searchPeople(
  input: PeopleFilters & { company?: { ref: string; name: string } | null },
): Promise<Page<PersonResult> & { refined: string[] }> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { company, ...filters } = input
  const source = getSource()
  const page = await source.searchPeople(company ?? null, filters)

  const fillDomain = (person: PersonResult) => {
    person.companyDomain ??= person.companyRef ? db.getProspectCompany(person.companyRef)?.domain ?? null : null
  }
  page.items.forEach(fillDomain)

  // Opted-out people are removed before anything is shown (or paid for),
  // silently — a count would tell the user that someone opted out.
  const suppressed = db.getSuppressionHashes()
  if (suppressed.size > 0) {
    page.items = page.items.filter(
      (p) => !isSuppressed(hashesFor({ profileUrl: p.profileUrl, firstName: p.firstName, lastName: p.lastName, domain: p.companyDomain }), suppressed),
    )
  }

  const alreadySaved = markPreviouslySeen(page.items, db)
  const toLookUp = page.items.filter((p) => p.previously !== 'saved')

  const refined: string[] = []
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
    page.items = page.items.map((p) => byUrl.get(p.profileUrl) ?? p)
    for (const r of results) if (r.refined) refined.push(r.person.profileUrl)
    const failed = results.filter((r) => r.error)
    if (first.error) {
      page.warnings.push(`Couldn't look up profiles (${first.error}), so titles and companies come from headlines.`)
    } else {
      if (failed.length > 0) {
        page.warnings.push(`${failed.length} profile ${failed.length === 1 ? 'lookup' : 'lookups'} failed (${failed[0].error}); showing the headline instead.`)
      }
      const missing = results.length - refined.length - failed.length
      if (missing > 0) {
        page.warnings.push(`${missing} ${missing === 1 ? 'profile has' : 'profiles have'} no current job listed; showing the headline instead.`)
      }
    }
  }
  if (alreadySaved > 0) {
    page.warnings.push(
      `${alreadySaved} ${alreadySaved === 1 ? 'person is' : 'people are'} already in your contacts, so their details come from there and no profile lookup was paid for.`,
    )
  }

  // With the real employer known, people who don't work at the chosen
  // company can be hidden.
  if (company && page.items.length > 0) {
    const before = page.items.length
    page.items = page.items.filter(
      (p) => !refined.includes(p.profileUrl) || p.companyRef === company.ref || sameCompanyName(p.company, company.name),
    )
    const hidden = before - page.items.length
    if (hidden > 0) {
      page.warnings.push(`${hidden} ${hidden === 1 ? "person doesn't" : "people don't"} currently work at ${company.name} and ${hidden === 1 ? 'was' : 'were'} hidden.`)
    }
  }

  // Mark people at companies already known to accept every address. The
  // page decides whether to hide them (it does while verified-only is on).
  // Only the cache is read: finding out about a new company would take an
  // SMTP check, and that waits until someone is actually revealed or saved.
  const now = Date.now()
  for (const p of page.items) {
    if (p.companyDomain && isKnownCatchAll(p.companyDomain, (d) => db.getEmailDomain(d), now)) p.catchAll = true
  }

  return { ...page, refined }
}

export async function startSave(listId: number, people: PersonResult[]) {
  const { db } = await import('../db')
  if (!db.data.lists.some((l) => l.id === listId)) throw new Error(`List ${listId} does not exist`)
  const { getSource, getFinderDeps } = await import('./runtime')
  const { saveProspects } = await import('./save')
  const { isVerifiedOnly } = await import('./settings')
  return saveProspects(listId, people, { source: getSource(), finder: await getFinderDeps(), db, verifiedOnly: isVerifiedOnly() })
}
