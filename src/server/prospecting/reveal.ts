// Reveal: find and verify one person's work email from the search results,
// without saving them.
//
// Revealing hands the user contact data just like saving does, so it follows
// the same rules: opted-out people are refused (checked by profile, name and
// domain before anything is spent, and by the address afterwards), and every
// reveal is written to the disclosure log as hashes. The address itself is
// not stored; it goes back to the browser and is only kept if the person is
// then saved.

import { domainForPerson } from './companies'
import { findEmail, type FinderDeps } from './emailFinder'
import { emailHash, hashesFor, isSuppressed, profileHash } from './suppression'
import type { CompanySource, EmailStatus, PersonResult } from './types'
import { recordUsage } from '../usage'

export type RevealResult =
  | { status: 'found'; email: string; emailStatus: EmailStatus; domain: string; greylisted: boolean; note?: string }
  | {
      /** `unconfirmed`: a likely address exists but wasn't verified, so it's withheld. */
      status: 'not_found' | 'no_domain' | 'unavailable' | 'unconfirmed'
      message: string
      /** Setting the right email domain for their company could fix this. */
      canFixDomain?: boolean
      /** A domain from the company's DNS that does take email, to offer in one click. */
      suggestedDomain?: string
      /** Their company accepts every address, so nobody there can be verified. */
      catchAll?: boolean
    }

export interface RevealDeps {
  source: CompanySource
  finder: FinderDeps
  db: typeof import('../db')['db']
  /** Withhold anything the mail server didn't confirm. Defaults to true. */
  verifiedOnly?: boolean
}

export async function revealEmail(person: PersonResult, deps: RevealDeps): Promise<RevealResult> {
  const suppressed = deps.db.getSuppressionHashes()
  // "Unavailable" rather than "opted out": the reason isn't shown, so the
  // button can't be used to learn who has opted out.
  const unavailable = { status: 'unavailable' as const, message: "This person's email isn't available." }

  if (isSuppressed(hashesFor(person), suppressed)) return unavailable

  const domain = await domainForPerson(person, deps.source, deps.db)
  if (!domain) {
    return {
      status: 'no_domain',
      message: person.companyRef ? "Their company's website isn't known." : "We don't know where they work.",
      canFixDomain: Boolean(person.companyRef),
    }
  }
  if (isSuppressed(hashesFor({ ...person, domain }), suppressed)) return unavailable

  const headcount = person.companyRef ? deps.db.getProspectCompany(person.companyRef)?.headcount : null
  const found = await findEmail(person, domain, deps.finder, { headcount })
  recordUsage({ emailLookups: 1 })
  if (!found.email) {
    return {
      status: 'not_found',
      message: found.detail ?? 'No deliverable address found.',
      canFixDomain: Boolean(found.domainProblem && person.companyRef),
      suggestedDomain: person.companyRef ? found.suggestedDomain : undefined,
    }
  }
  if (isSuppressed(hashesFor({ email: found.email }), suppressed)) return unavailable

  // An unconfirmed guess is never handed over (or logged as disclosed) while
  // verified-only is on.
  if ((deps.verifiedOnly ?? true) && found.status !== 'verified') {
    return {
      status: 'unconfirmed',
      message: found.reason ?? found.detail ?? 'No address could be confirmed.',
      catchAll: found.status === 'catch_all_likely' || undefined,
    }
  }

  deps.db.addDisclosure({
    contact_hash: emailHash(found.email),
    profile_hash: profileHash(person.profileUrl),
    sources: [person.source],
    event: 'revealed',
    notice_status: null,
  })
  recordUsage({ emailsFound: 1 })
  return { status: 'found', email: found.email, emailStatus: found.status, domain, greylisted: found.greylisted, note: found.detail }
}
