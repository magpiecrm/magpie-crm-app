// A web search, for finding a company's website when it has no LinkedIn
// page to read one from (companySite.ts). Results come from a search
// provider's API (Decodo's Web Scraping API, Google results as JSON); nothing
// is fetched from LinkedIn.
//
// A hosted copy asks its host (POST {REACHER_URL}/v1/web-search), which holds
// the key; any other copy uses its own WEB_SEARCH_API_KEY. With neither,
// there's no web search and nothing here runs. Only a company's name goes in
// a query, never a person's; its country says where to search from, since a
// small firm's own site comes first only in its own country's results.

import { env } from '../env'
import { canonicalCountry } from './geo'
import { hostWebSearch } from './hostRules'

export interface WebResult {
  url: string
  title: string
  description: string
}

export type WebSearch = (query: string, country?: string | null) => Promise<WebResult[]>

const TIMEOUT_MS = 30_000
const MAX_RESULTS = 8

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Reads organic results out of whatever shape came back, keeping the first few. */
function organic(list: unknown): WebResult[] {
  if (!Array.isArray(list)) return []
  return list
    .map((r: any) => ({ url: clean(r?.url, 500), title: clean(r?.title, 300), description: clean(r?.description ?? r?.desc, 500) }))
    .filter((r) => /^https?:\/\//i.test(r.url))
    .slice(0, MAX_RESULTS)
}

/** Google results through Decodo's Web Scraping API. Throws when it can't be reached or refuses. */
export async function decodoSearch(apiKey: string, query: string, opts: { url?: string; fetchImpl?: typeof fetch; country?: string | null } = {}): Promise<WebResult[]> {
  // Only a country we know by name: anything else would be searched from nowhere in particular anyway.
  const geo = canonicalCountry(opts.country)
  const res = await (opts.fetchImpl ?? fetch)(opts.url ?? 'https://data.decodo.com/v1/scrape', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ target: 'google_search', query, parse: true, ...(geo ? { geo } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Web search answered ${res.status}`)
  const content = ((await res.json()) as any)?.results?.[0]?.content
  return organic(content?.results?.organic ?? content?.results?.results?.organic)
}

/** The web search this copy can use, or null when it has none. */
export function webSearcher(fetchImpl: typeof fetch = fetch): WebSearch | null {
  const hostUrl = env.reacher.url()
  const secret = env.reacher.secret()
  if (env.prospectingManaged()) {
    if (!hostWebSearch() || !hostUrl || !secret) return null
    return async (query, country) => {
      const res = await fetchImpl(`${hostUrl}/v1/web-search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reacher-secret': secret },
        body: JSON.stringify({ query, ...(country ? { country } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS + 5_000),
      })
      if (!res.ok) throw new Error(`Web search answered ${res.status}`)
      return organic(((await res.json()) as any)?.results)
    }
  }
  const key = env.webSearch.apiKey()
  return key ? (query, country) => decodoSearch(key, query, { url: env.webSearch.url(), fetchImpl, country }) : null
}
