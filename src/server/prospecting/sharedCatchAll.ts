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

/** What the host knows of a company: whether it accepts every address, and, when it knows, when it found out. */
export interface SharedVerdict {
  catchAll: boolean | null
  checkedAt?: string
  confirmed?: boolean
}

/**
 * For each company, what the host knows of whether it accepts every address
 * (null for a company not asked about). All null outside a hosted copy, or
 * when the host doesn't answer in time: search carries on either way.
 */
export async function sharedCatchAllVerdicts(companies: Company[], fetchImpl: typeof fetch = fetch): Promise<Array<SharedVerdict | null>> {
  const none = companies.map(() => null)
  const url = env.reacher.url()
  const secret = env.reacher.secret()
  if (!env.prospectingManaged() || !url || !secret) return none
  const asked = companies.filter((c) => c.ref || c.domain).slice(0, 100)
  if (asked.length === 0) return none
  try {
    const res = await fetchImpl(`${url}/v1/catch-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-reacher-secret': secret },
      body: JSON.stringify({ companies: asked.map((c) => ({ ref: c.ref ?? undefined, domain: c.domain ?? undefined })) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return none
    const answers: any[] = ((await res.json()) as any)?.companies ?? []
    const byCompany = new Map<Company, SharedVerdict>()
    asked.forEach((c, i) => {
      const a = answers[i]
      const catchAll = typeof a?.catchAll === 'boolean' ? a.catchAll : null
      const checkedAt = typeof a?.checkedAt === 'string' && !Number.isNaN(Date.parse(a.checkedAt)) ? a.checkedAt : undefined
      byCompany.set(c, { catchAll, ...(checkedAt ? { checkedAt, confirmed: a?.confirmed === true } : {}) })
    })
    return companies.map((c) => byCompany.get(c) ?? null)
  } catch {
    return none
  }
}

/** For each company, whether the host knows it accepts every address (sharedCatchAllVerdicts). */
export async function sharedCatchAll(companies: Company[], fetchImpl: typeof fetch = fetch): Promise<boolean[]> {
  return (await sharedCatchAllVerdicts(companies, fetchImpl)).map((v) => v?.catchAll === true)
}
