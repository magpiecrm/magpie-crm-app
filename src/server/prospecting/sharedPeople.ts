// In a hosted copy (PROSPECTING_MANAGED, e.g. MagpieCRM Cloud), the host may
// run a shared database of business contacts: copies that choose to
// contribute send it the people they save from prospect search with a
// verified email, so the next copy looking for the same person doesn't buy
// them again. The host is the controller of that database: it tells each
// person before anyone can be shown them, and takes their opt-out.
//
// This is the one place a copy sends personal data to its host, and only
// once someone here has agreed to the host's Contributor Terms (Settings →
// Prospect search). What's sent is what search itself held: name, job title,
// employer, country, profile address and the verified work email. Never an
// imported or signed-up contact, a guessed address, notes, lists, or
// anything about what was emailed to them. A copy that isn't hosted, or
// hasn't joined, sends nothing. Contacts saved the same way before the copy
// joined are offered too, a batch at a time, except anyone who has
// unsubscribed, complained or bounced here.
//
// Any hosted copy's searches can also use that database, where the host has
// switched it on. The search itself is unchanged; of the people it finds, the
// host is asked which it already holds (by the keyed hash of their profile
// address, the same one the opt-out list uses, never a name). For those, their
// job and employer come from the host instead of a paid profile lookup, and
// their email from the host instead of being worked out. That's free to a
// copy that contributes; the host says when it isn't.

import { env } from '../env'
import { refreshHostRules, sharedDatabase } from './hostRules'
import { profileHash } from './suppressionHash'
import type { EmailStatus, PersonResult, Seniority } from './types'

const TIMEOUT_MS = 10_000
/** A search doesn't wait long to hear who's held: without an answer it looks everyone up as before. */
const KNOWN_TIMEOUT_MS = 4_000
const MAX_ASKED = 200

async function post(path: string, body: unknown, fetchImpl: typeof fetch, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const url = env.reacher.url()
  const secret = env.reacher.secret()
  if (!env.prospectingManaged() || !url || !secret) throw new Error("This copy isn't hosted, so there's no shared database to join.")
  return fetchImpl(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-reacher-secret': secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

type Db = typeof import('../db')['db']
/** The host takes 200 at a time; the slack is for contacts saved in the same instant, who go together. */
const BATCH = 150
const HOST_MAX = 200

/**
 * Offers the host the contacts this copy saved from prospect search before
 * it joined (or that the host had no room for then): oldest first, one batch
 * a call, carrying on next time from where the host stopped taking them.
 * Returns how many it took. Only contacts with a verified email who can
 * still be emailed here; one whose email came from the database itself
 * (source `shared`) is never sent back.
 */
export async function contributeSaved(db: Pick<Db, 'data' | 'emailStop' | 'getProspectingSettings' | 'saveProspectingSettings'>, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!sharedDatabase()?.contributing) return 0
  const settings = db.getProspectingSettings()
  const from = settings?.shared_offered_until ?? ''
  const waiting = db.data.contacts
    .filter((c) => c.source === 'socialfetch' && c.email_status === 'verified' && c.status === 'subscribed' && c.created_at > from && !db.emailStop(c.email))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (waiting.length === 0) return 0
  let size = Math.min(BATCH, waiting.length)
  while (size < waiting.length && size < HOST_MAX && waiting[size].created_at === waiting[size - 1].created_at) size++
  const due = waiting.slice(0, size)
  const people = due.map((c) => ({
    firstName: c.first_name,
    lastName: c.last_name,
    title: c.job_title,
    company: c.company,
    email: c.email,
    emailStatus: 'verified',
    source: 'socialfetch',
    verifiedAt: c.created_at,
  }))
  const res = await post('/v1/pool/contribute', { people }, fetchImpl)
  if (!res.ok) return 0
  const body = (await res.json()) as { accepted?: number; full?: number }
  // Those it had no room for are the last in the batch: they're offered again
  // next time, so the place kept is the last moment before the first of them.
  const taken = due.length - Math.min(due.length, Math.max(0, Number(body.full) || 0))
  const until =
    taken === due.length
      ? due[taken - 1].created_at
      : due
          .slice(0, taken)
          .reverse()
          .find((c) => c.created_at < due[taken].created_at)?.created_at
  if (until) db.saveProspectingSettings({ ...(settings ?? { updated_at: new Date().toISOString() }), shared_offered_until: until })
  return Number(body.accepted) || 0
}

/** What the host holds about someone a search found: their job and employer, and the handle for their email. */
export interface SharedPerson {
  handle: string
  title: string
  seniority: Seniority | null
  company: string
  companyRef: string | null
  companyDomain: string | null
  country: string | null
  /** When their email was last verified. */
  verifiedAt: string
}

/**
 * Which of these people the host's shared database holds, by profile
 * address. Empty where the host hasn't switched searching on, and when it
 * doesn't answer in time: the search carries on without it.
 */
export async function knownPeople(people: PersonResult[], fetchImpl: typeof fetch = fetch): Promise<Map<string, SharedPerson>> {
  const found = new Map<string, SharedPerson>()
  if (!sharedDatabase()?.search || people.length === 0) return found
  const byHash = new Map<string, string>()
  for (const p of people.slice(0, MAX_ASKED)) {
    const hash = profileHash(p.profileUrl)
    if (hash) byHash.set(hash, p.profileUrl)
  }
  try {
    const res = await post('/v1/pool/known', { profiles: [...byHash.keys()] }, fetchImpl, KNOWN_TIMEOUT_MS)
    if (!res.ok) return found
    for (const k of ((await res.json()) as any)?.people ?? []) {
      const url = byHash.get(k?.profile)
      if (!url || typeof k.handle !== 'string' || typeof k.company !== 'string' || !k.company) continue
      found.set(url, {
        handle: k.handle,
        title: typeof k.title === 'string' ? k.title : '',
        seniority: k.seniority ?? null,
        company: k.company,
        companyRef: typeof k.companyRef === 'string' ? k.companyRef : null,
        companyDomain: typeof k.companyDomain === 'string' ? k.companyDomain : null,
        country: typeof k.country === 'string' ? k.country : null,
        verifiedAt: typeof k.verifiedAt === 'string' ? k.verifiedAt : '',
      })
    }
  } catch {
    // Carry on without it.
  }
  return found
}

/**
 * The verified email of someone the host holds, for the handle a search was
 * given, and whether it was free. Null when the host can't give it (they've
 * been removed since, or the handle is old): the email is then found the
 * usual way.
 */
export async function sharedEmail(handle: string, fetchImpl: typeof fetch = fetch): Promise<{ email: string; free: boolean } | null> {
  try {
    const res = await post('/v1/pool/reveal', { handle }, fetchImpl)
    if (!res.ok) return null
    const body = (await res.json()) as any
    return typeof body?.email === 'string' && body.email.includes('@') ? { email: body.email.toLowerCase(), free: body.free === true } : null
  } catch {
    return null
  }
}

/** Joins or leaves, recording who decided; throws with the host's reason when it refuses. */
export async function setContributing(contribute: boolean, actor: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await post('/v1/pool/membership', { contribute, actor, termsVersion: sharedDatabase()?.termsVersion }, fetchImpl)
  const body = (await res.json().catch(() => null)) as { contributing?: boolean; error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? "The shared database isn't available right now.")
  await refreshHostRules(fetchImpl)
  return body?.contributing === true
}

/**
 * Sends a contact just saved from prospect search to the host's database,
 * when this copy contributes and the address was verified. Never waited on
 * and never fails a save: the host decides what it keeps.
 */
export function contribute(person: PersonResult, email: string, status: EmailStatus, fetchImpl: typeof fetch = fetch): void {
  // Someone whose email came from the database isn't sent back to it as newly verified.
  if (!sharedDatabase()?.contributing || status !== 'verified' || person.source !== 'socialfetch' || person.shared) return
  const { profileUrl, firstName, lastName, title, company, companyRef, country, source } = person
  void post('/v1/pool/contribute', { people: [{ profileUrl, firstName, lastName, title, company, companyRef, country, email, emailStatus: status, source }] }, fetchImpl).catch(() => {})
}
