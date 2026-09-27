// Keyed hashes of the identifiers an opt-out covers (see suppression.ts).
// Kept apart from the list itself, with nothing that touches the database, so
// a host can hash the same way for its copies.

import crypto from 'crypto'
import { env } from '../env'
import { foldName } from './patterns'
import { canonicalProfileUrl } from './socialfetch'

/** What a hash identifies: an email address, a LinkedIn profile, or a name at a company domain. */
export type SuppressionKind = 'email' | 'profile' | 'name_domain'

export interface SuppressionHash {
  kind: SuppressionKind
  hash: string
}

/** `secret` is SUPPRESSION_SECRET unless given (a host hashing for its copies). */
function hmac(kind: SuppressionKind, value: string, secret = env.suppressionSecret()): string {
  return crypto.createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex')
}

export function normaliseDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\d?\./, '').replace(/\/.*$/, '')
}

function normaliseName(firstName: string, lastName: string): string {
  return foldName(`${firstName} ${lastName}`).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function emailHash(email: string, secret?: string): string {
  return hmac('email', email.toLowerCase().trim(), secret)
}

export function profileHash(profileUrl: string, secret?: string): string | null {
  const canonical = canonicalProfileUrl(profileUrl)
  return canonical ? hmac('profile', canonical, secret) : null
}

export function nameDomainHash(firstName: string, lastName: string, domain: string, secret?: string): string | null {
  const name = normaliseName(firstName, lastName)
  const d = normaliseDomain(domain)
  // A lone first name would suppress every namesake at the company.
  if (!d || name.split(' ').length < 2) return null
  return hmac('name_domain', `${name}|${d}`, secret)
}

/** Every hash that identifies this person with the data we have for them. */
export function hashesFor(
  p: {
    email?: string | null
    profileUrl?: string | null
    firstName?: string
    lastName?: string
    domain?: string | null
  },
  secret?: string,
): SuppressionHash[] {
  const out: SuppressionHash[] = []
  if (p.email) out.push({ kind: 'email', hash: emailHash(p.email, secret) })
  const ph = p.profileUrl ? profileHash(p.profileUrl, secret) : null
  if (ph) out.push({ kind: 'profile', hash: ph })
  const nd = p.domain && (p.firstName || p.lastName) ? nameDomainHash(p.firstName ?? '', p.lastName ?? '', p.domain, secret) : null
  if (nd) out.push({ kind: 'name_domain', hash: nd })
  return out
}
