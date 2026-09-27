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
//
// A host running many copies can give them all the same SUPPRESSION_SECRET
// and pass opt-outs between them (/api/usage/suppressions), so someone who
// opts out of one is left alone by all of them.

import { emailHash, hashesFor, nameDomainHash, type SuppressionHash } from './suppressionHash'

export { emailHash, hashesFor, normaliseDomain, profileHash, type SuppressionHash } from './suppressionHash'

export function isSuppressed(hashes: SuppressionHash[], suppressed: Set<string>): boolean {
  return hashes.some((h) => suppressed.has(h.hash))
}

/**
 * Handles an opt-out from the public page: adds the person's hashes to the
 * global list and deletes every saved contact that matches them (see
 * applySuppression).
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
  const hashes = hashesFor(input)
  if (hashes.length === 0) return { removed: 0 }
  const { removed } = await applySuppression(hashes, 'opt_out')
  console.log(`[Suppression] Opt-out recorded (${hashes.length} identifiers, ${removed} contacts removed)`)
  return { removed }
}

/**
 * Adds hashes to the list and deletes every saved contact they match, found
 * by email/name hash directly or through the disclosure log for profile URLs.
 * For an opt-out here, or one passed on by the host from another copy
 * ('shared').
 */
export async function applySuppression(hashes: SuppressionHash[], reason: 'opt_out' | 'shared'): Promise<{ added: number; removed: number }> {
  const { db } = await import('../db')
  const { deleteContacts } = await import('../emailService')
  if (hashes.length === 0) return { added: 0, removed: 0 }
  const added = db.addSuppression(hashes, reason)

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
  if (extra.length > 0) db.addSuppression(extra, reason)

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
  return { added, removed: matches.length }
}
