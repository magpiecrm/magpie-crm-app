// In a copy whose verification is run by its host (PROSPECTING_MANAGED, e.g.
// MagpieCRM Cloud), companies known to accept every address are shared by
// every copy there: one copy's made-up check at a company tells the host, and
// the others ask about the companies in their search results, so people there
// are hidden before anyone spends a lookup on them.
//
// Company data only: each company's LinkedIn ref and, when known, its mail
// domain. The host answers yes, no or not known for each.

import { env } from '../env'

interface Company {
  ref: string | null
  domain: string | null
}

const TIMEOUT_MS = 3_000

/**
 * For each company, whether the host knows it accepts every address. All
 * false outside a hosted copy, or when the host doesn't answer in time:
 * search carries on either way.
 */
export async function sharedCatchAll(companies: Company[], fetchImpl: typeof fetch = fetch): Promise<boolean[]> {
  const none = companies.map(() => false)
  const url = env.reacher.url()
  const secret = env.reacher.secret()
  if (!env.prospectingManaged() || !url || !secret) return none
  const asked = companies.filter((c) => c.ref || c.domain)
  if (asked.length === 0) return none
  try {
    const res = await fetchImpl(`${url}/v1/catch-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-reacher-secret': secret },
      body: JSON.stringify({ companies: asked.slice(0, 100).map((c) => ({ ref: c.ref ?? undefined, domain: c.domain ?? undefined })) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return none
    const answers: Array<{ catchAll: boolean | null }> = ((await res.json()) as any)?.companies ?? []
    const yes = new Set(asked.filter((_, i) => answers[i]?.catchAll === true))
    return companies.map((c) => yes.has(c))
  } catch {
    return none
  }
}
