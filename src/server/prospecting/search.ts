// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import type { CompanyFilters, CompanyResult, Page, PeopleFilters, PeopleSource, PersonResult } from './types'
import { sameCompanyName } from './socialfetch'
import { hashesFor, isSuppressed } from './suppression'

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
    page.items.map((c) => ({ ref: c.ref, name: c.name, domain: c.domain, domain_source: 'socialfetch' as const })),
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

/** One profile lookup (3 credits): the person's real current title and employer. */
async function enrichOne(person: PersonResult, source: PeopleSource, db: Db): Promise<{ person: PersonResult; refined: boolean }> {
  const profile = await source.getPerson(person.profileUrl)
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
      companyDomain: db.getProspectCompany(profile.companyRef)?.domain ?? null,
      country: person.country ?? profile.country,
    },
  }
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

  const refined: string[] = []
  if (page.items.length > 0) {
    // Check the first profile before paying for the rest: if lookups don't
    // come back with a current position, the rest of the page would be wasted.
    const first = await enrichOne(page.items[0], source, db)
    const results = first.refined
      ? [first, ...(await mapLimit(page.items.slice(1), ENRICH_CONCURRENCY, (p) => enrichOne(p, source, db)))]
      : [first]
    results.forEach((r, i) => {
      page.items[i] = r.person
      if (r.refined) refined.push(r.person.profileUrl)
    })
    if (!first.refined) {
      page.warnings.push(
        "Couldn't read a current job from the first profile, so the rest of this page wasn't looked up, to save credits.",
      )
    } else if (refined.length < results.length) {
      const missing = results.length - refined.length
      page.warnings.push(`${missing} ${missing === 1 ? 'profile has' : 'profiles have'} no current job listed; showing the headline instead.`)
    }

    // With the real employer known, people who don't work at the chosen
    // company can be hidden.
    if (company) {
      const before = page.items.length
      page.items = page.items.filter(
        (p) => !refined.includes(p.profileUrl) || p.companyRef === company.ref || sameCompanyName(p.company, company.name),
      )
      const hidden = before - page.items.length
      if (hidden > 0) {
        page.warnings.push(`${hidden} ${hidden === 1 ? "person doesn't" : "people don't"} currently work at ${company.name} and ${hidden === 1 ? 'was' : 'were'} hidden.`)
      }
    }
  }

  return { ...page, refined }
}

export async function startSave(listId: number, people: PersonResult[]) {
  const { db } = await import('../db')
  if (!db.data.lists.some((l) => l.id === listId)) throw new Error(`List ${listId} does not exist`)
  const { getSource, getFinderDeps } = await import('./runtime')
  const { saveProspects } = await import('./save')
  return saveProspects(listId, people, { source: getSource(), finder: await getFinderDeps(), db })
}
