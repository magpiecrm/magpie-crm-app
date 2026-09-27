import type { PersonResult } from './types'

/**
 * A search result corrected from the person's profile: their current job's
 * real title and employer, rather than what was guessed from their headline.
 * A current job without a company page still has its title and employer
 * name; only the company link stays unknown. Null when the profile listed
 * no current job, which leaves the search result as it was.
 */
export function refineFromProfile(person: PersonResult, profile: PersonResult | null): PersonResult | null {
  if (!profile || (!profile.title && !profile.company && !profile.companyRef)) return null
  return {
    ...person,
    title: profile.title || person.title,
    seniority: profile.title ? profile.seniority : person.seniority,
    company: profile.company || person.company,
    companyRef: profile.companyRef ?? person.companyRef,
    companySlug: profile.companySlug ?? person.companySlug ?? null,
    country: person.country ?? profile.country,
  }
}
