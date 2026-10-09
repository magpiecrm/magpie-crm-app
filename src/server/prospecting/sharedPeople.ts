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
// hasn't joined, sends nothing.

import { env } from '../env'
import { refreshHostRules, sharedDatabase } from './hostRules'
import type { EmailStatus, PersonResult } from './types'

const TIMEOUT_MS = 10_000

async function post(path: string, body: unknown, fetchImpl: typeof fetch): Promise<Response> {
  const url = env.reacher.url()
  const secret = env.reacher.secret()
  if (!env.prospectingManaged() || !url || !secret) throw new Error("This copy isn't hosted, so there's no shared database to join.")
  return fetchImpl(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-reacher-secret': secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
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
  if (!sharedDatabase()?.contributing || status !== 'verified' || person.source !== 'socialfetch') return
  const { profileUrl, firstName, lastName, title, company, companyRef, country, source } = person
  void post('/v1/pool/contribute', { people: [{ profileUrl, firstName, lastName, title, company, companyRef, country, email, emailStatus: status, source }] }, fetchImpl).catch(() => {})
}
