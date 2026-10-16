// Hiring and funding signals for the companies on a page of prospect search
// results (webSignals.ts reads them out of web searches).
//
// A hosted copy asks its host (POST {REACHER_URL}/v1/company-signals), which
// runs the searches, caches what it finds and shares it between the copies
// it hosts: company data only. Any other copy runs them with its own
// WEB_SEARCH_API_KEY when SIGNAL_LOOKUPS=on, caching here (db
// company_signals). With neither there are none, and the page doesn't offer
// them.
//
// Never slows a search: the page asks for the companies it shows once
// they're on screen, gets what's known at once, and asks again for those
// still being looked up (`pending`).

import { env } from '../env'
import { hostSignals } from './hostRules'
import { signalKey } from './signals'
import type { Signal } from './types'
import { fundingQuery, hiringQuery, parseFunding, parseHiring, type SignalCompany } from './webSignals'
import { webSearcher, type WebSearch } from './webSearch'

export type WebSignalKind = 'hiring' | 'funding'
export const WEB_SIGNAL_KINDS: readonly WebSignalKind[] = ['hiring', 'funding']

export interface SignalsAnswer {
  /** By company key (signals.ts signalKey). */
  signals: Record<string, Signal[]>
  /** Companies still being looked up: ask again shortly. */
  pending: string[]
}

type Db = typeof import('../db')['db']

const DAY = 86_400_000
/** How long an answer is kept: what was found, and that nothing was. */
export const SIGNAL_TTL: Record<WebSignalKind, { found: number; none: number }> = {
  hiring: { found: 14 * DAY, none: 7 * DAY },
  funding: { found: 30 * DAY, none: 30 * DAY },
}
const AT_ONCE = 4
const HOST_TIMEOUT_MS = 25_000

/** Which kinds this copy can look up, for the page to offer. */
export function webSignalKinds(): WebSignalKind[] {
  if (env.prospectingManaged()) return hostSignals() ? [...WEB_SIGNAL_KINDS] : []
  return env.webSearch.signals() && env.webSearch.apiKey() ? [...WEB_SIGNAL_KINDS] : []
}

// A company being looked up now, so the page asking again doesn't search twice.
const inFlight = new Map<string, Promise<void>>()

/** One company's search for one kind, its answer kept. Failed searches aren't kept: they're tried again next time. */
async function lookUp(db: Db, search: WebSearch, key: string, c: SignalCompany, kind: WebSignalKind, now: Date) {
  const id = `${key}|${kind}`
  const running = inFlight.get(id)
  if (running) return running
  const job = (async () => {
    try {
      const results = kind === 'hiring' ? await search(hiringQuery(c), c.country) : await search(fundingQuery(c), c.country, { recent: 'year' })
      db.setCompanySignal(key, kind, kind === 'hiring' ? parseHiring(c, results, now) : parseFunding(c, results, now), now)
      const { recordUsage } = await import('../usage')
      recordUsage({ signalSearches: 1 })
    } catch {
      // Not kept: asked again next time.
    }
  })().finally(() => inFlight.delete(id))
  inFlight.set(id, job)
  return job
}

/**
 * Signals for these companies: what's known now, with at most `liveMax`
 * companies searched for live (waiting up to `waitMs` for them); the rest
 * come back as pending and are searched on a later ask.
 */
export async function companySignals(
  companies: SignalCompany[],
  opts: { kinds?: readonly WebSignalKind[]; liveMax?: number; waitMs?: number; db?: Db; search?: WebSearch | null; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<SignalsAnswer> {
  const kinds = (opts.kinds ?? WEB_SIGNAL_KINDS).filter((k) => webSignalKinds().includes(k) || opts.search)
  const answer: SignalsAnswer = { signals: {}, pending: [] }
  if (!kinds.length || !companies.length) return answer
  const unique = new Map<string, SignalCompany>()
  for (const c of companies.slice(0, 50)) {
    const key = signalKey(c)
    if (key && !unique.has(key)) unique.set(key, c)
  }
  const now = opts.now ?? new Date()

  if (env.prospectingManaged() && !opts.search) {
    const hostUrl = env.reacher.url()
    const secret = env.reacher.secret()
    if (!hostUrl || !secret) return answer
    try {
      const res = await (opts.fetchImpl ?? fetch)(`${hostUrl}/v1/company-signals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reacher-secret': secret },
        body: JSON.stringify({ kinds, companies: [...unique].map(([key, c]) => ({ key, name: c.name, domain: c.domain ?? null, country: c.country ?? null })) }),
        signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
      })
      if (!res.ok) return { signals: {}, pending: [...unique.keys()] }
      const body = (await res.json()) as Partial<SignalsAnswer>
      return { signals: body.signals ?? {}, pending: Array.isArray(body.pending) ? body.pending : [] }
    } catch {
      return { signals: {}, pending: [...unique.keys()] }
    }
  }

  const search = opts.search === undefined ? webSearcher() : opts.search
  if (!search) return answer
  const db = opts.db ?? (await import('../db')).db
  const fresh = (key: string, kind: WebSignalKind) => {
    const kept = db.getCompanySignal(key, kind)
    if (!kept) return undefined
    const ttl = kept.signal ? SIGNAL_TTL[kind].found : SIGNAL_TTL[kind].none
    return now.getTime() - Date.parse(kept.at) < ttl ? kept.signal : undefined
  }
  const misses: Array<[string, SignalCompany, WebSignalKind]> = []
  for (const [key, c] of unique) for (const kind of kinds) if (fresh(key, kind) === undefined) misses.push([key, c, kind])
  // Live: the first `liveMax` companies' misses, a few at a time, waited for up to `waitMs`.
  const liveKeys = [...new Set(misses.map(([key]) => key))].slice(0, opts.liveMax ?? 10)
  const live = misses.filter(([key]) => liveKeys.includes(key))
  const work = (async () => {
    for (let i = 0; i < live.length; i += AT_ONCE) await Promise.all(live.slice(i, i + AT_ONCE).map(([key, c, kind]) => lookUp(db, search, key, c, kind, now)))
  })()
  await Promise.race([work, new Promise((r) => setTimeout(r, opts.waitMs ?? 20_000))])

  for (const [key] of unique) {
    const found = kinds.map((kind) => fresh(key, kind)).filter((s): s is Signal => Boolean(s))
    if (found.length) answer.signals[key] = found
    if (kinds.some((kind) => fresh(key, kind) === undefined)) answer.pending.push(key)
  }
  return answer
}
