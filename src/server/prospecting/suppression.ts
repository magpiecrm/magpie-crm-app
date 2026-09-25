// Global suppression list and opt-out handling.
//
// Identifiers are stored as HMAC-SHA256 hashes keyed with SUPPRESSION_SECRET,
// so the list can't be read back into names or addresses, and unkeyed
// dictionary attacks against it don't work. Three identifiers are hashed:
//   email        — normalised address
//   profile      — canonical LinkedIn profile URL
//   name_domain  — folded "first last" + company domain
// A person is suppressed if any one of theirs matches. Suppression is checked
// before search results are shown and again when saving.

import crypto from 'crypto'
import { env } from '../env'
import type { SuppressionKind } from '../db'
import { foldName } from './patterns'
import { canonicalProfileUrl } from './socialfetch'

export interface SuppressionHash {
  kind: SuppressionKind
  hash: string
}

function hmac(kind: SuppressionKind, value: string): string {
  return crypto.createHmac('sha256', env.suppressionSecret()).update(`${kind}:${value}`).digest('hex')
}

export function normaliseDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\d?\./, '').replace(/\/.*$/, '')
}

function normaliseName(firstName: string, lastName: string): string {
  return foldName(`${firstName} ${lastName}`).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function emailHash(email: string): string {
  return hmac('email', email.toLowerCase().trim())
}

export function profileHash(profileUrl: string): string | null {
  const canonical = canonicalProfileUrl(profileUrl)
  return canonical ? hmac('profile', canonical) : null
}

function nameDomainHash(firstName: string, lastName: string, domain: string): string | null {
  const name = normaliseName(firstName, lastName)
  const d = normaliseDomain(domain)
  // A lone first name would suppress every namesake at the company.
  if (!d || name.split(' ').length < 2) return null
  return hmac('name_domain', `${name}|${d}`)
}

/** Every hash that identifies this person with the data we have for them. */
export function hashesFor(p: {
  email?: string | null
  profileUrl?: string | null
  firstName?: string
  lastName?: string
  domain?: string | null
}): SuppressionHash[] {
  const out: SuppressionHash[] = []
  if (p.email) out.push({ kind: 'email', hash: emailHash(p.email) })
  const ph = p.profileUrl ? profileHash(p.profileUrl) : null
  if (ph) out.push({ kind: 'profile', hash: ph })
  const nd = p.domain && (p.firstName || p.lastName) ? nameDomainHash(p.firstName ?? '', p.lastName ?? '', p.domain) : null
  if (nd) out.push({ kind: 'name_domain', hash: nd })
  return out
}

export function isSuppressed(hashes: SuppressionHash[], suppressed: Set<string>): boolean {
  return hashes.some((h) => suppressed.has(h.hash))
}

/**
 * Handles an opt-out from the public page: adds the person's hashes to the
 * global list and deletes every saved contact that matches them, found by
 * email/name hash directly or through the disclosure log for profile URLs.
 *
 * Returns only a count, and the public route never shows it, so the page
 * can't be used to test whether we hold someone's data.
 */
export async function processOptOut(input: {
  email?: string
  profileUrl?: string
  firstName?: string
  lastName?: string
  domain?: string
}): Promise<{ removed: number }> {
  const { db } = await import('../db')
  const { deleteContacts } = await import('../emailService')

  const hashes = hashesFor(input)
  if (hashes.length === 0) return { removed: 0 }
  db.addSuppression(hashes, 'opt_out')

  const wanted = new Set(hashes.map((h) => h.hash))

  // Profile URLs aren't on the contact itself; the disclosure log maps them to
  // the contact's email hash.
  const viaLog = new Set(
    db.getDisclosures()
      .filter((d) => d.profile_hash && wanted.has(d.profile_hash))
      .map((d) => d.contact_hash),
  )

  const matches = db.data.contacts.filter((c) => {
    const eh = emailHash(c.email)
    if (wanted.has(eh) || viaLog.has(eh)) return true
    const domain = c.email.split('@')[1]
    const nd = domain ? nameDomainHash(c.first_name, c.last_name, domain) : null
    return nd !== null && wanted.has(nd)
  })

  // Whatever identifier they gave, suppress every identifier we hold for each
  // matched contact: search only sees names and profile URLs, and saving
  // checks the email.
  const extra: SuppressionHash[] = []
  for (const c of matches) {
    const eh = emailHash(c.email)
    extra.push({ kind: 'email', hash: eh })
    const domain = c.email.split('@')[1]
    const nd = domain ? nameDomainHash(c.first_name, c.last_name, domain) : null
    if (nd) extra.push({ kind: 'name_domain', hash: nd })
    for (const d of db.getDisclosures()) {
      if (d.contact_hash === eh && d.profile_hash) extra.push({ kind: 'profile', hash: d.profile_hash })
    }
  }
  if (extra.length > 0) db.addSuppression(extra, 'opt_out')

  for (const c of matches) {
    db.addDisclosure({
      contact_hash: emailHash(c.email),
      profile_hash: null,
      sources: c.source ? [c.source] : [],
      event: 'opted_out',
      notice_status: c.notice_status ?? null,
    })
  }
  if (matches.length > 0) await deleteContacts(matches.map((c) => c.email))

  console.log(`[Suppression] Opt-out recorded (${hashes.length} identifiers, ${matches.length} contacts removed)`)
  return { removed: matches.length }
}
