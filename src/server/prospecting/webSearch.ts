// A web search, for finding a company's website when it has no LinkedIn
// page to read one from (companySite.ts), and for people search from the
// public LinkedIn profiles a search engine has indexed (webSource.ts).
// Results come from a search provider's API (Decodo's Web Scraping API,
// Google results as JSON); nothing is fetched from LinkedIn.
//
// A hosted copy asks its host (POST {REACHER_URL}/v1/web-search), which holds
// the key; any other copy uses its own WEB_SEARCH_API_KEY. With neither,
// there's no web search and nothing here runs. A query names a company, or
// job titles and company names (people search), never a person; its country
// says where to search from, since a small firm's own site comes first only
// in its own country's results.

import { env } from '../env'
import { canonicalCountry } from './geo'
import { hostWebSearch } from './hostRules'

export interface WebResult {
  url: string
  title: string
  description: string
  /**
   * The short facts Google shows under some results. For a LinkedIn profile
   * these are its location, job title and employer, in that order (checked
   * 2026-10-17).
   */
  info?: string[]
}

export interface WebSearchOptions {
  /** Results from the past year only (Google's own filter). */
  recent?: 'year'
  /** Which page of results, from 1 (10 a page). */
  page?: number
  /**
   * Take the query as written, with Google's spelling correction off. Without
   * it Decodo can't read the results of a query with OR or several quoted
   * phrases at all (checked 2026-10-17).
   */
  exact?: boolean
  /** Keep every result on the page rather than the first few. */
  all?: boolean
}

export type WebSearch = (query: string, country?: string | null, opts?: WebSearchOptions) => Promise<WebResult[]>

/**
 * The provider tried and couldn't get the results page (Decodo's status 613:
 * Google turned it away). Nothing was learned, so nothing should be kept as
 * if there were no results; asking again usually works.
 */
export class WebSearchUnavailable extends Error {
  constructor(message = "The web search couldn't get the results just now.") {
    super(message)
    this.name = 'WebSearchUnavailable'
  }
}

const TIMEOUT_MS = 30_000
const MAX_RESULTS = 8
/** A page of Google results. */
const PAGE_RESULTS = 10
/** Google's deepest page through Decodo. */
export const MAX_PAGE = 10

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Reads organic results out of whatever shape came back, keeping the first few (or every one, `all`). */
function organic(list: unknown, all = false): WebResult[] {
  if (!Array.isArray(list)) return []
  return list
    .map((r: any) => {
      const info = Array.isArray(r?.additional_info ?? r?.info) ? (r.additional_info ?? r.info).filter((x: unknown) => typeof x === 'string').map((x: string) => clean(x, 200)).slice(0, 5) : []
      return { url: clean(r?.url, 500), title: clean(r?.title, 300), description: clean(r?.description ?? r?.desc, 500), ...(info.length ? { info } : {}) }
    })
    .filter((r) => /^https?:\/\//i.test(r.url))
    .slice(0, all ? PAGE_RESULTS : MAX_RESULTS)
}

const pageOf = (page: number | undefined) => Math.min(MAX_PAGE, Math.max(1, Math.floor(page ?? 1)))

/** Google results through Decodo's Web Scraping API. Throws when it can't be reached or refuses (WebSearchUnavailable when Google turned it away). */
export async function decodoSearch(apiKey: string, query: string, opts: { url?: string; fetchImpl?: typeof fetch; country?: string | null } & WebSearchOptions = {}): Promise<WebResult[]> {
  // Only a country we know by name: anything else would be searched from nowhere in particular anyway.
  const geo = canonicalCountry(opts.country)
  const page = pageOf(opts.page)
  const res = await (opts.fetchImpl ?? fetch)(opts.url ?? 'https://data.decodo.com/v1/scrape', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      target: 'google_search',
      query,
      parse: true,
      ...(geo ? { geo } : {}),
      ...(opts.recent === 'year' ? { google_tbs: 'qdr:y' } : {}),
      ...(page > 1 ? { page_from: String(page) } : {}),
      ...(opts.exact ? { google_nfpr: true } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Web search answered ${res.status}`)
  const body = (await res.json()) as any
  const first = body?.results?.[0]
  // A search it couldn't do comes back 200 with no results and a message, not as an empty page.
  if (!first) throw new WebSearchUnavailable(body?.status_code ? `Web search couldn't get the results (status ${body.status_code})` : undefined)
  const content = first.content
  return organic(content?.results?.organic ?? content?.results?.results?.organic, opts.all)
}

/** The web search this copy can use, or null when it has none. */
export function webSearcher(fetchImpl: typeof fetch = fetch): WebSearch | null {
  const hostUrl = env.reacher.url()
  const secret = env.reacher.secret()
  if (env.prospectingManaged()) {
    if (!hostWebSearch() || !hostUrl || !secret) return null
    return async (query, country, opts) => {
      const res = await fetchImpl(`${hostUrl}/v1/web-search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reacher-secret': secret },
        body: JSON.stringify({
          query,
          ...(country ? { country } : {}),
          ...(opts?.recent ? { recent: opts.recent } : {}),
          ...(opts?.page && opts.page > 1 ? { page: pageOf(opts.page) } : {}),
          ...(opts?.exact ? { exact: true } : {}),
          ...(opts?.all ? { all: true } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS + 5_000),
      })
      // The host says when the provider couldn't get the page, so it isn't taken for no results.
      if (res.status === 503) throw new WebSearchUnavailable()
      if (!res.ok) throw new Error(`Web search answered ${res.status}`)
      return organic(((await res.json()) as any)?.results, opts?.all)
    }
  }
  const key = env.webSearch.apiKey()
  return key ? (query, country, opts) => decodoSearch(key, query, { url: env.webSearch.url(), fetchImpl, country, ...opts }) : null
}
