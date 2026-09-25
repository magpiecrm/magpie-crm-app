// Entry points shared by the server functions and the copilot's tools, so both
// get the same caching, suppression and save behaviour.

import type { CompanyFilters, CompanyResult, Page, PeopleFilters, PersonResult } from './types'
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

export async function searchPeople(
  input: PeopleFilters & { company?: { ref: string; name: string } | null },
): Promise<Page<PersonResult>> {
  const { getSource } = await import('./runtime')
  const { db } = await import('../db')
  const { company, ...filters } = input
  const page = await getSource().searchPeople(company ?? null, filters)

  // With a chosen company every result has already been checked to work
  // there, so its domain applies even when the person's own org id differs.
  const chosenDomain = company ? db.getProspectCompany(company.ref)?.domain ?? null : null
  for (const person of page.items) {
    person.companyDomain ??= chosenDomain ?? (person.companyRef ? db.getProspectCompany(person.companyRef)?.domain ?? null : null)
  }

  // Opted-out people are removed before anything is shown, silently — a count
  // would tell the user that someone at this company opted out.
  const suppressed = db.getSuppressionHashes()
  if (suppressed.size > 0) {
    page.items = page.items.filter(
      (p) => !isSuppressed(hashesFor({ profileUrl: p.profileUrl, firstName: p.firstName, lastName: p.lastName, domain: p.companyDomain }), suppressed),
    )
  }
  return page
}

export async function startSave(listId: number, people: PersonResult[]) {
  const { db } = await import('../db')
  if (!db.data.lists.some((l) => l.id === listId)) throw new Error(`List ${listId} does not exist`)
  const { getSource, getFinderDeps } = await import('./runtime')
  const { saveProspects } = await import('./save')
  return saveProspects(listId, people, { source: getSource(), finder: await getFinderDeps(), db })
}
