// Reveal: find and verify one person's work email from the search results,
// without saving them.
//
// Revealing hands the user contact data just like saving does, so it follows
// the same rules: opted-out people are refused (checked by profile, name and
// domain before anything is spent, and by the address afterwards), and every
// reveal is written to the disclosure log as hashes. The address itself is
// not stored; it goes back to the browser and is only kept if the person is
// then saved.

import { domainForPerson, type DomainSource } from './companies'
import { findEmailCounted, type FinderDeps } from './emailFinder'
import { recordFinderStats } from './finderStats'
import { emailHash, hashesFor, isSuppressed, profileHash } from './suppression'
import { handsOver, type CompanySource, type EmailStatus, type PersonResult } from './types'
import { recordLookup, recordUsage } from '../usage'
import { noteSearchLookup } from './searchLog'
import { requireAllowance } from '../allowance'
import { rememberIfUnverifiable } from './unverifiable'
import { isPacing } from './proxyRouter'

/** How soon the page tries a Reveal again that verification pacing held back. */
export const PACING_RETRY_MS = 20_000
/** How soon a Reveal is tried again whose company's mail server asked us to try later (greylisting). */
export const GREYLIST_RETRY_MS = 5 * 60_000

/**
 * Reveals waiting to try once more the addresses their company's mail server
 * greylisted: by the keyed hash of the person's profile, the keyed hashes of
 * those addresses and the domain, never the link or an address. In memory,
 * for half an hour.
 */
const greylistRetries = new Map<string, { emails: string[]; domain: string; at: number }>()
const GREYLIST_KEPT_MS = 30 * 60_000

export type RevealResult =
  | { status: 'found'; email: string; emailStatus: EmailStatus; domain: string; greylisted: boolean; note?: string }
  /**
   * Held back by verification pacing (nothing was checked or used), or by a
   * mail server that asked us to try again later (`greylisted`: nothing is
   * counted until the retry): the page tries again in `retryInMs`.
   */
  | { status: 'waiting'; message: string; retryInMs: number; greylisted?: boolean }
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
      /** No retry would verify them, so they're remembered and later searches can leave them out. */
      unverifiable?: boolean
    }

export interface RevealDeps {
  source: CompanySource
  finder: FinderDeps
  db: typeof import('../db')['db']
  /** Withhold anything the mail server didn't confirm. Defaults to true. */
  verifiedOnly?: boolean
  /** With `verifiedOnly`, still hand over `format_confirmed` guesses. */
  allowFormatConfirmed?: boolean
  /** Gives the email of someone held in the host's shared database (sharedPeople.ts sharedEmail). */
  sharedEmail?: (handle: string) => Promise<{ email: string; free: boolean } | null>
  /** This copy contributes to that database, so its emails are free. */
  sharedFree?: boolean
}

export async function revealEmail(person: PersonResult, deps: RevealDeps): Promise<RevealResult> {
  // A plan's reveal allowance: checked before anything is looked up. An
  // email the host's shared database gives a contributor doesn't use it.
  const fromShared = Boolean(person.shared && deps.sharedEmail)
  if (!(fromShared && deps.sharedFree)) requireAllowance('reveals')
  const suppressed = deps.db.getSuppressionHashes()
  // "Unavailable" rather than "opted out": the reason isn't shown, so the
  // button can't be used to learn who has opted out.
  const unavailable = { status: 'unavailable' as const, message: "This person's email isn't available." }

  if (isSuppressed(hashesFor(person), suppressed)) return unavailable

  // Held in the host's shared database: it gives the address it verified.
  // If it can't (they've been removed since), the address is found as usual.
  const held = fromShared ? await deps.sharedEmail!(person.shared!) : null
  if (held) {
    if (isSuppressed(hashesFor({ email: held.email }), suppressed)) return unavailable
    deps.db.addDisclosure({
      contact_hash: emailHash(held.email),
      profile_hash: profileHash(person.profileUrl),
      sources: [person.source],
      event: 'revealed',
      notice_status: null,
    })
    recordUsage(held.free ? { sharedEmails: 1 } : { emailsFound: 1 })
    return { status: 'found', email: held.email, emailStatus: 'verified', domain: held.email.split('@')[1], greylisted: false }
  }
  if (fromShared && deps.sharedFree) requireAllowance('reveals')

  const how: { source?: DomainSource } = {}
  const domain = await domainForPerson(person, deps.source, deps.db, undefined, how)
  const noted = { source: how.source, check: person.mailCheck }
  if (!domain) {
    recordLookup('noDomain')
    void noteSearchLookup(person.searchId, 'noDomain', noted)
    return {
      status: 'no_domain',
      message: person.companyRef ? "Their company's website isn't known." : "We don't know where they work.",
      canFixDomain: Boolean(person.companyRef),
    }
  }
  if (isSuppressed(hashesFor({ ...person, domain }), suppressed)) return unavailable

  const headcount = person.companyRef ? deps.db.getProspectCompany(person.companyRef)?.headcount : null
  // A retry after greylisting checks only the format the mail server asked us to try again.
  const retryKey = profileHash(person.profileUrl)
  for (const [key, held] of greylistRetries) if (Date.now() - held.at > GREYLIST_KEPT_MS) greylistRetries.delete(key)
  const retry = retryKey ? greylistRetries.get(retryKey) : undefined
  const retrying = retry && retry.domain === domain ? retry : undefined
  // Asked again before the mail server's wait is over (a second tab, say): still waiting, the retry kept.
  if (retrying && Date.now() - retrying.at < GREYLIST_RETRY_MS) {
    return {
      status: 'waiting',
      message: "Their company's mail server asked us to try again in a few minutes, so this tries once more then.",
      retryInMs: GREYLIST_RETRY_MS - (Date.now() - retrying.at),
      greylisted: true,
    }
  }
  if (retryKey) greylistRetries.delete(retryKey)
  let found: Awaited<ReturnType<typeof findEmailCounted>>
  try {
    const retryOnly = retrying ? (email: string) => retrying.emails.includes(emailHash(email)) : undefined
    found = await findEmailCounted(person, domain, deps.finder, { headcount, ...(retryOnly ? { retrying: retryOnly } : {}) })
  } catch (err) {
    if (isPacing(err)) {
      if (retryKey && retrying) greylistRetries.set(retryKey, retrying)
      return { status: 'waiting', message: err.message, retryInMs: PACING_RETRY_MS }
    }
    throw err
  }
  // Greylisted the first time: tried once more in a few minutes, and nothing is counted until then.
  if (found.outcome === 'greylisted' && found.greylistedEmails?.length && !retrying && retryKey) {
    greylistRetries.set(retryKey, { emails: found.greylistedEmails.map((e) => emailHash(e)), domain, at: Date.now() })
    while (greylistRetries.size > 500) greylistRetries.delete(greylistRetries.keys().next().value!)
    return {
      status: 'waiting',
      message: "Their company's mail server asked us to try again in a few minutes, so this tries once more then.",
      retryInMs: GREYLIST_RETRY_MS,
      greylisted: true,
    }
  }
  recordUsage({ emailLookups: 1 })
  recordLookup(found.outcome)
  void recordFinderStats(person, found, headcount)
  void noteSearchLookup(person.searchId, found.outcome, noted)
  if (!found.email) {
    return {
      status: 'not_found',
      message: found.detail ?? 'No deliverable address found.',
      canFixDomain: Boolean(found.domainProblem && person.companyRef),
      suggestedDomain: person.companyRef ? found.suggestedDomain : undefined,
      unverifiable: rememberIfUnverifiable(person.profileUrl, found.outcome, deps.db) || undefined,
    }
  }
  if (isSuppressed(hashesFor({ email: found.email }), suppressed)) return unavailable

  // An unconfirmed guess is never handed over (or logged as disclosed) while
  // verified-only is on, except a `format_confirmed` one if allowed.
  if (!handsOver(found.status, deps)) {
    return {
      status: 'unconfirmed',
      message: found.reason ?? found.detail ?? 'No address could be confirmed.',
      catchAll: found.status === 'catch_all_likely' || found.status === 'format_confirmed' || undefined,
      unverifiable: rememberIfUnverifiable(person.profileUrl, found.outcome, deps.db) || undefined,
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
