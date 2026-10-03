// SocialFetch connector (https://api.socialfetch.dev, `x-api-key` auth).
//
// Endpoints used, all confirmed against SocialFetch's published OpenAPI spec
// and llms.json route inventory:
//   GET /v2/linkedin/organizations/search  keyword (required), count, cursor   3 credits
//   GET /v1/linkedin/companies             url (company page, by slug)          1 credit
//   GET /v2/linkedin/organizations         id | slug                          6-9 credits
//   GET /v2/linkedin/people/search         keyword, count, start/cursor       3 credits
//   GET /v2/linkedin/profiles              handle                             3 credits
//   GET /v1/balance                        (free)
//
// Confirmed against the live API: people search matches `keyword` by
// relevance, not as a filter, so job titles go in `title`, which filters on
// the title in each person's headline (free text; SocialFetch fixed
// multi-word titles on 2026-09-30, taking them with underscores until their
// release). Search hits carry only name, profile URL, headline and a
// free-text `location` (no positions, employer or structured country), and
// page by offset (`start`) rather than cursor.
//
// The docs give no value formats; these were checked against the live API
// (2026-09-28): `currentCompany` takes numeric company ids, several
// comma-separated; organization search's `headcountRange` takes this app's
// buckets ("11-50", comma-separated, up to 20) and needs a `keyword`; its
// `geoEntityId` barely narrows by country, so companies' head-office country
// is checked after. Seniority is a post-filter over what comes back.

import { AsyncLocalStorage } from 'node:async_hooks'
import { env } from '../env'
import { canonicalCountry, geoIdForCountry } from './geo'
import { industryCodes } from '../../features/prospects/constants/industryCodes'
import { classifySeniority } from './seniority'
import { createSearchPool, searchPoolKey, type HeldHits, type Hit } from './searchPool'
import type {
  CompanyFilters,
  CompanyRef,
  CompanyResult,
  CompanySource,
  HeadcountBucket,
  Page,
  PeopleFilters,
  PeopleSource,
  PersonResult,
} from './types'

const SOURCE = 'socialfetch' as const
const PAGE_SIZE = 25
/** Companies asked for per organization search: 3 credits whether it returns 1 or 50 (checked 2026-10-01). */
const ORG_FETCH_SIZE = 50
const TIMEOUT_MS = 25_000
const MAX_ATTEMPTS = 3
// Several titles become one request each (the API takes a single `title`).
const MAX_TITLES = 5
// SocialFetch's documented maximum for `start`.
const MAX_START = 999
/**
 * What every new people-search request asks for, SocialFetch's maximum: a
 * request costs 3 credits whatever it returns, so the people a page doesn't
 * use are held (searchPool.ts) for its next page or top-up.
 */
const FETCH_SIZE = 50
/**
 * Company ids one people search takes in `currentCompany`, comma-separated.
 * Checked against the live API (2026-09-28): two companies searched together
 * return exactly the people each returns alone.
 */
export const MAX_COMPANIES_PER_SEARCH = 20

class SocialFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'unauthorized' | 'credits_exhausted' | 'bad_request' | 'unavailable' | 'upstream',
  ) {
    super(message)
    this.name = 'SocialFetchError'
  }
}

type Fetch = typeof fetch
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Credits SocialFetch charged inside `fn` (and whatever it awaits), for work
 * that's paid for by what it actually cost: a plan's prospect credits
 * (search.ts). Concurrent searches each get their own count.
 */
const meter = new AsyncLocalStorage<{ credits: number }>()
export async function meterCredits<T>(fn: (spent: () => number) => Promise<T>): Promise<{ result: T; credits: number }> {
  const store = { credits: 0 }
  const result = await meter.run(store, () => fn(() => store.credits))
  return { result, credits: store.credits }
}

interface Envelope<T> {
  data: T
  meta?: { requestId?: string; creditsCharged?: number }
}

/**
 * One GET with timeout, retry and error classification. Only the path, status,
 * request id and credits are logged — never query values, which can contain
 * names.
 */
async function request<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  fetchImpl: Fetch,
  apiKey: string,
): Promise<Envelope<T>> {
  const url = new URL(path, env.socialfetch.baseUrl())
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetchImpl(url, {
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      lastError = err
      console.warn(`[SocialFetch] ${path} network error (attempt ${attempt}/${MAX_ATTEMPTS})`)
      if (attempt < MAX_ATTEMPTS) await sleep(backoff(attempt))
      continue
    }
    clearTimeout(timer)

    if (res.ok) {
      const body = (await res.json()) as Envelope<T>
      const charged = body.meta?.creditsCharged
      const store = meter.getStore()
      if (store && typeof charged === 'number' && charged > 0) store.credits += charged
      console.log(
        `[SocialFetch] ${path} 200 req=${body.meta?.requestId ?? '?'} credits=${body.meta?.creditsCharged ?? '?'}`,
      )
      return body
    }

    const message = await errorMessage(res)
    console.warn(`[SocialFetch] ${path} ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS})`)

    // 429 is per-key limiting on free routes; 503 is saturation on paid ones
    // and is not charged. 500/502 are not charged on the v2 routes (502 is
    // SocialFetch's normalisation failure), so a retry costs nothing; the v1
    // company page charges its 1 credit for a 502, but a retry is still
    // cheaper than the 6-credit organization lookup it would fall back to.
    if ([429, 500, 502, 503].includes(res.status) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt))
      lastError = new SocialFetchError(message, res.status, 'unavailable')
      continue
    }
    throw classify(res.status, message)
  }
  if (lastError instanceof SocialFetchError) throw lastError
  throw new SocialFetchError(env.prospectingManaged() ? 'Search did not respond. Try again shortly.' : 'SocialFetch did not respond. Try again shortly.', 0, 'unavailable')
}

function backoff(attempt: number) {
  return 500 * 2 ** (attempt - 1) + Math.random() * 250
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return String(body?.error?.message ?? body?.error ?? body?.message ?? res.statusText)
  } catch {
    return res.statusText
  }
}

function classify(status: number, message: string): SocialFetchError {
  // Run by the host (PROSPECTING_MANAGED): its data source isn't named, and
  // there's no key or balance here for the user to fix.
  if (env.prospectingManaged()) {
    if (status === 401 || status === 403) return new SocialFetchError("Search isn't available for this workspace right now. Contact support if it continues.", status, 'unauthorized')
    if (status === 402) return new SocialFetchError('This workspace has used its search allowance for this billing period.', status, 'credits_exhausted')
    if (status === 400 || status === 422) return new SocialFetchError(`The search couldn't run: ${message}`, status, 'bad_request')
    if (status === 429 || status === 503) return new SocialFetchError('Search is busy. Try again in a moment.', status, 'unavailable')
    return new SocialFetchError(`Search failed (error ${status}). Try again shortly.`, status, 'upstream')
  }
  if (status === 401 || status === 403) {
    return new SocialFetchError('SocialFetch rejected the API key. Check it in Settings → Data source.', status, 'unauthorized')
  }
  if (status === 402) {
    return new SocialFetchError('SocialFetch credits are exhausted. Top up your balance to keep searching.', status, 'credits_exhausted')
  }
  if (status === 400 || status === 422) {
    return new SocialFetchError(`SocialFetch could not run this search: ${message}`, status, 'bad_request')
  }
  if (status === 429 || status === 503) {
    return new SocialFetchError('SocialFetch is busy. Try again in a moment.', status, 'unavailable')
  }
  return new SocialFetchError(`SocialFetch error ${status}: ${message}`, status, 'upstream')
}

// --- mapping -----------------------------------------------------------------

/** `https://www.acme.co.uk/about` -> `acme.co.uk`. */
export function domainFromWebsite(website: unknown): string | null {
  if (typeof website !== 'string' || !website.trim()) return null
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
    const host = url.hostname.toLowerCase().replace(/^www\d?\./, '')
    // LinkedIn/linktree/etc. are not the company's mail domain.
    if (!host.includes('.') || /(^|\.)(linkedin\.com|linktr\.ee|facebook\.com|instagram\.com)$/.test(host)) return null
    return host
  } catch {
    return null
  }
}

/** Canonical `https://www.linkedin.com/in/{handle}` or null. */
export function canonicalProfileUrl(url: unknown, handle?: unknown): string | null {
  const fromHandle = typeof handle === 'string' && handle.trim() ? handle.trim() : null
  if (typeof url === 'string') {
    const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
    if (m) return `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}`
  }
  return fromHandle ? `https://www.linkedin.com/in/${fromHandle.toLowerCase()}` : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** An identifier that may arrive as a string or a number. */
/**
 * A LinkedIn id, or null. LinkedIn sends 0 for a job with no company page
 * (and some records carry "0"): that's no id, never organization 0, which
 * the organizations endpoint answers with a slow 503.
 */
function idOf(v: unknown): string | null {
  const id = typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v)
  return id && !/^0+$/.test(id) ? id : null
}

/** A real numeric LinkedIn id (not 0). */
const numericId = (ref: string | null | undefined): ref is string => Boolean(ref && /^\d+$/.test(ref) && !/^0+$/.test(ref))

/** "https://www.linkedin.com/company/acme-ltd/" -> "acme-ltd". */
function companySlug(position: any): string | null {
  const direct = str(position?.organizationSlug) ?? str(position?.organizationHandle)
  if (direct) return direct
  const url = str(position?.organizationUrl) ?? str(position?.organization?.url)
  const m = url?.match(/linkedin\.com\/(?:company|school)\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Lower bound of a range label like "51-200 employees" or "10,001+". */
function rangeFloor(label: unknown): number | null {
  if (typeof label !== 'string') return null
  const m = label.replace(/[,\s]/g, '').match(/\d+/)
  return m ? Number(m[0]) : null
}

function mapOrganization(o: any): CompanyResult | null {
  const ref = str(o?.liveOrganizationId) ?? str(o?.entityId) ?? str(o?.slug) ?? str(o?.universalName)
  const name = str(o?.name)
  if (!ref || !name) return null
  const slug = str(o?.slug) ?? str(o?.universalName)
  return {
    ref,
    name,
    domain: domainFromWebsite(o?.website),
    industry: str(o?.industry) ?? str(o?.industriesV2?.[0]?.name) ?? str(o?.industriesV2?.[0]) ?? null,
    headcount: num(o?.staffCount) ?? num(o?.headcount) ?? rangeFloor(o?.staffCountRange) ?? rangeFloor(o?.headcountRange),
    companyType: str(o?.type),
    country: str(o?.headquarter?.country) ?? str(o?.hqCountry) ?? str(o?.headquarter?.countryCode) ?? str(o?.hqCountryCode),
    linkedinUrl: str(o?.url) ?? (slug ? `https://www.linkedin.com/company/${slug}` : null),
    source: SOURCE,
  }
}

/**
 * The 1-credit company page (`/v1/linkedin/companies`): the same website and
 * headcount as the 6-9 credit organization lookup, but only by page URL.
 */
function mapCompanyPage(d: any, ref: string): CompanyResult | null {
  const c = d?.company
  const name = str(c?.name)
  if (!name) return null
  return {
    ref: idOf(c?.id) ?? ref,
    name,
    domain: domainFromWebsite(c?.website),
    industry: str(c?.industry),
    headcount: num(d?.metrics?.employees) ?? rangeFloor(c?.employeeRange),
    companyType: null,
    // An ISO code ("GB"), as the organization lookup's hqCountryCode.
    country: str(c?.location?.country),
    linkedinUrl: str(c?.companyUrl) ?? str(c?.url) ?? null,
    source: SOURCE,
  }
}

/** "https://www.linkedin.com/company/acme-ltd" -> "acme-ltd". */
export function slugFromCompanyUrl(url: string | null | undefined): string | null {
  const m = url?.match(/linkedin\.com\/company\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : null
}

function splitFullName(full: string | null): [string, string] {
  if (!full) return ['', '']
  const parts = full.trim().split(/\s+/)
  return [parts[0] ?? '', parts.slice(1).join(' ')]
}

/**
 * Keeps only the fields the product is allowed to hold. Everything else in the
 * provider record — pictures, summary, skills, education, follower counts,
 * city-level location, languages — is dropped here and never stored.
 */
export function mapPerson(p: any): PersonResult | null {
  const profileUrl = canonicalProfileUrl(p?.profileUrl, p?.handle)
  if (!profileUrl) return null

  let firstName = str(p?.firstName) ?? ''
  let lastName = str(p?.lastName) ?? ''
  if (!firstName && !lastName) [firstName, lastName] = splitFullName(str(p?.fullName))
  if (!firstName && !lastName) return null

  const positions: any[] = [
    ...(Array.isArray(p?.currentPositions) ? p.currentPositions : []),
    ...(Array.isArray(p?.positions) ? p.positions.filter((x: any) => x?.isCurrent) : []),
  ]
  const current = positions.find((x) => x?.isCurrent !== false) ?? null

  // Search hits carry only a headline; the part before "at …" / "| …" is
  // the best title we have. Profiles carry the real current position, but
  // `currentPositions` often names only the employer: the title is on the
  // same job in the full position list.
  const headline = str(p?.headline)
  const history: any[] = [...(Array.isArray(p?.positions) ? p.positions : []), ...(Array.isArray(p?.fullPositions) ? p.fullPositions : [])]
  const sameJob = current ? history.find((x) => str(x?.title) && sameEmployer(x, current)) : null
  const title = str(current?.title) ?? str(sameJob?.title) ?? titleFromHeadline(headline) ?? ''
  return {
    profileUrl,
    firstName,
    lastName,
    title,
    seniority: classifySeniority(title),
    company: str(current?.organizationName) ?? str(current?.organization?.name) ?? companyFromHeadline(headline) ?? '',
    // Numeric id when present; otherwise the company page's slug, which the
    // organizations endpoint also accepts.
    companyRef: idOf(current?.organizationId) ?? idOf(current?.organization?.id) ?? companySlug(current) ?? idOf(sameJob?.organizationId) ?? companySlug(sameJob) ?? null,
    // The page name too, for the 1-credit company lookup (the id costs 6).
    // The current-job entry often has only the id; the same job in the full
    // list has the page.
    companySlug: companySlug(current) ?? companySlug(sameJob),
    companyDomain: null,
    // Only the country survives; the city-level label is dropped here.
    country: str(p?.geo?.country) ?? str(p?.geoCountry) ?? countryFromLocation(p?.location),
    source: SOURCE,
  }
}

/** Two position records for the same employer: by id, page or name. */
function sameEmployer(a: any, b: any): boolean {
  const id = (x: any) => idOf(x?.organizationId) ?? idOf(x?.organization?.id)
  if (id(a) && id(b)) return id(a) === id(b)
  if (companySlug(a) && companySlug(b)) return companySlug(a) === companySlug(b)
  const name = (x: any) => (str(x?.organizationName) ?? str(x?.organization?.name) ?? '').toLowerCase()
  return name(a) !== '' && name(a) === name(b)
}

// --- job title matching ------------------------------------------------------
// People search matches its keyword by relevance, not as a filter: inside a
// few small companies it returns everyone there, whatever their job. So each
// hit's headline is checked for the title searched for before its profile is
// paid for (confirmed against the live API, 2026-09-29).

const TITLE_FILLER = new Set(['of', 'and', 'the', 'for', 'in', 'a', 'an', 'to', '&', '-', '/', '+'])

/** Titles and their usual abbreviations: either one finds the other. */
const SAME_TITLE: Array<[string, string]> = [
  ['ceo', 'chief executive officer'],
  ['cfo', 'chief financial officer'],
  ['coo', 'chief operating officer'],
  ['cto', 'chief technology officer'],
  ['cmo', 'chief marketing officer'],
  ['cio', 'chief information officer'],
  ['cro', 'chief revenue officer'],
  ['cpo', 'chief product officer'],
  ['chro', 'chief human resources officer'],
  ['ciso', 'chief information security officer'],
  ['svp', 'senior vice president'],
  ['evp', 'executive vice president'],
  ['vp', 'vice president'],
  ['md', 'managing director'],
  ['hr', 'human resources'],
  ['bdm', 'business development manager'],
]

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a headline names the job title searched for: every word of it (or
 * of its usual abbreviation or long form) in one part of the headline,
 * before any " at <company>". "Sales Manager" fits "Regional Sales Manager"
 * and "Sales & Account Manager at Acme", not "Key Account Manager"; a word of
 * four letters or fewer must stand alone, so "CFO" doesn't fit "Helping CFOs".
 */
export function titleMatcher(title: string): (headline: string | null | undefined) => boolean {
  const base = norm(title).replace(/\s+/g, ' ')
  const forms = new Set([base])
  for (const [short, long] of SAME_TITLE) {
    const s = new RegExp(`\\b${short}\\b`)
    if (s.test(base)) forms.add(base.replace(s, long))
    if (base.includes(long)) forms.add(base.replace(long, short))
  }
  const patterns = [...forms].map((form) =>
    form
      .split(' ')
      .filter((w) => w && !TITLE_FILLER.has(w))
      .map((w) => new RegExp(w.length <= 4 ? `\\b${escapeRegExp(w)}\\b` : `\\b${escapeRegExp(w)}`, 'i')),
  )
  return (headline) => {
    if (!headline) return false
    const roles = headline.split(/\s*[|•·]\s*/).map((part) => part.split(/\s+(?:at|@)\s+|@/i)[0])
    return patterns.some((words) => words.length > 0 && roles.some((role) => words.every((w) => w.test(role))))
  }
}

/** Words that make a role a leader's: "Head of", "VP", "Director" and the like. */
const LEADER_WORDS = /\b(?:head|heads|vp|svp|evp|avp|vice[- ]president|director|chief)\b/i
/** Words around a leadership title that don't change which department it leads. */
const QUALIFIERS = /\b(?:global|senior|sr|regional|group|national|international|interim|deputy|assistant|associate|area)\b\.?/gi
/** "X Director" titles that are a role of their own, not the leader of a department. */
const NOT_A_DEPARTMENT = new Set(['managing', 'executive', 'non executive', 'non-executive', 'general', 'company', 'board', 'account', 'client', 'art', 'creative', 'technical'])

/**
 * The department a leadership title leads ("Head of Sales", "VP of Sales",
 * "Sales Director", "Sales leaders" -> "Sales"), or null for any other
 * title. People word these many ways and SocialFetch's title filter only
 * matches the words given, in order ("VP Sales" misses "VP of Sales";
 * checked 2026-10-03: 1 "Head of Sales" against 7 sales leaders among the
 * "Sales" results at the same 20 companies), so the department is searched
 * and its leaders kept (leaderMatcher).
 */
export function leadershipDepartment(title: string): string | null {
  const t = title.replace(QUALIFIERS, ' ').replace(/[,–—]|\s-\s/g, ' ').replace(/\s+/g, ' ').trim()
  const m = t.match(/^(?:head|vp|svp|evp|avp|vice president|director)\s+(?:of\s+)?(.+)$/i) ?? t.match(/^(.+?)\s+(?:director|head|leaders?|leadership)$/i)
  const department = m?.[1]?.replace(/^the\s+/i, '').trim()
  if (!department || department.split(' ').length > 3 || NOT_A_DEPARTMENT.has(department.toLowerCase()) || LEADER_WORDS.test(department)) return null
  return department
}

/** Whether a headline has a leadership role in the department: "VP of Sales", "Sales Director", "Head of Sales & Partnerships". */
export function leaderMatcher(department: string): (headline: string | null | undefined) => boolean {
  const inDepartment = titleMatcher(department)
  return (headline) => {
    if (!headline) return false
    const roles = headline.split(/\s*[|•·]\s*/).map((part) => part.split(/\s+(?:at|@)\s+|@/i)[0])
    return roles.some((role) => LEADER_WORDS.test(role) && inDepartment(role))
  }
}

/**
 * Departments whose leaders also go by another department's name, searched
 * too. Checked 2026-10-03 at 60 US software companies: "Revenue" found 8
 * leaders (Chief Revenue Officer, VP of Revenue) that "Sales" didn't, beside
 * its 19; "CRO" on its own found none that either missed.
 */
const ALSO_LEADS: Record<string, string[]> = { sales: ['Revenue'] }

/** What's searched for one job title: the title itself, or for a leadership title its department (leadershipDepartment). */
interface TitleQuery {
  /** Its cursor and held results go under this. */
  key: string
  search: string
  fits: ((headline: string | null) => boolean) | null
  /** The leadership titles searched as this department. */
  leaders: string[]
}

function titleQueries(titles: string[]): TitleQuery[] {
  const out = new Map<string, TitleQuery>()
  for (const title of titles) {
    const department = title ? leadershipDepartment(title) : null
    if (!department) {
      if (!out.has(title)) out.set(title, { key: title, search: title, fits: title ? titleMatcher(title) : null, leaders: [] })
      continue
    }
    for (const search of [department, ...(ALSO_LEADS[norm(department)] ?? [])]) {
      const key = `leaders:${norm(search)}`
      const query = out.get(key) ?? { key, search, fits: leaderMatcher(search), leaders: [] }
      if (!query.leaders.includes(title)) query.leaders.push(title)
      out.set(key, query)
    }
  }
  return [...out.values()]
}

/** People-search requests one page takes for these job titles (titleQueries): several leadership titles can share one, and sales leaders take two. */
export function searchesForTitles(titles: string[] | undefined): number {
  const unique = [...new Set((titles ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TITLES)
  return Math.max(1, titleQueries(unique).length)
}

/** "Senior Business Analyst at Barclays | Agile" -> "Senior Business Analyst". */
export function titleFromHeadline(headline: string | null): string | null {
  if (!headline) return null
  const first = headline.split(/\s+(?:at|@)\s+|\s*[|•·]\s*/i)[0]?.trim()
  return first || headline
}

/** "Business Analyst at Barclays | Agile" -> "Barclays". Display only. */
function companyFromHeadline(headline: string | null): string | null {
  if (!headline) return null
  const m = headline.match(/\s(?:at|@)\s+([^|•·,;()]+)/i)
  const company = m?.[1]?.trim().replace(/[.\s]+$/, '')
  return company && company.length <= 80 ? company : null
}

/** "Leeds, England, United Kingdom" -> "United Kingdom". */
function countryFromLocation(label: unknown): string | null {
  if (typeof label !== 'string' || !label.trim()) return null
  const last = label.split(',').pop()!.trim().replace(/\s+(metropolitan )?area$/i, '')
  // A city-only label ("Exeter") isn't a country; keep it as-is so it doesn't
  // masquerade as one, and let the geo filter supply the country instead.
  return canonicalCountry(last) ?? (last || null)
}

/**
 * Field names (never values) of a record the mapper couldn't read, so a
 * response-shape mismatch can be diagnosed from the server log without
 * writing anyone's personal data to it.
 */
function describeShape(raw: any): string {
  if (!raw || typeof raw !== 'object') return typeof raw
  const nested = (key: string) => {
    const v = Array.isArray(raw[key]) ? raw[key][0] : raw[key]
    return v && typeof v === 'object' ? `${key}{${Object.keys(v).join(',')}}` : null
  }
  return [
    Object.keys(raw).join(','),
    nested('currentPositions'),
    nested('positions'),
    nested('geo'),
  ]
    .filter(Boolean)
    .join(' | ')
}

// --- post-filters ------------------------------------------------------------

const BUCKET_BOUNDS: Record<HeadcountBucket, [number, number]> = {
  '1-10': [1, 10],
  '11-50': [11, 50],
  '51-200': [51, 200],
  '201-500': [201, 500],
  '501-1000': [501, 1000],
  '1001-5000': [1001, 5000],
  '5001-10000': [5001, 10000],
  '10001+': [10001, Number.POSITIVE_INFINITY],
}

function inHeadcountBuckets(headcount: number | null, buckets: HeadcountBucket[]): boolean {
  if (buckets.length === 0) return true
  if (headcount === null) return false
  return buckets.some((b) => headcount >= BUCKET_BOUNDS[b][0] && headcount <= BUCKET_BOUNDS[b][1])
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim()
const people_ = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

function matchesCountry(value: string | null, wanted?: string) {
  if (!wanted?.trim()) return true
  const w = norm(canonicalCountry(wanted) ?? wanted)
  return norm(value).includes(w) || w.includes(norm(value) || '\u0000')
}

/** Company names compared loosely: "Acme Ltd" and "ACME" are the same employer. */
/** A company name without punctuation or suffixes like Ltd and Group: "The Acme Group Ltd." -> "acme". */
export const companyKey = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(ltd|limited|llc|inc|plc|gmbh|corp|corporation|co|group|holdings|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function sameCompanyName(a: string, b: string): boolean {
  const ca = companyKey(a)
  const cb = companyKey(b)
  return Boolean(ca && cb && (ca === cb || ca.startsWith(`${cb} `) || cb.startsWith(`${ca} `)))
}

// --- composite cursors -------------------------------------------------------
// Multi-title people search runs one paged request per title. The cursor handed
// back to the client carries every per-title position; exhausted titles drop out.
// A position is `start:N` (an offset, which works with any page size) or, when
// SocialFetch only offers its own cursor, `c<size>:<cursor>`: SocialFetch
// rejects a cursor reused with a different page size ("Pagination cursor does
// not match this request"), so the size it was made with travels with it.

/**
 * Where a page cursor carries on from. Pages are always asked for by offset
 * (`start:N`): SocialFetch's own cursor names the exact filters it was made
 * with and is refused ("Pagination cursor does not match this request") if a
 * request differs at all, which saved positions from before its release on
 * 2026-09-30 did. One from before is read for the offset inside it.
 */
export function startFrom(cursor: string | null | undefined): number {
  if (!cursor) return 0
  const own = cursor.match(/^start:(\d+)$/)
  if (own) return Number(own[1])
  const sized = cursor.match(/^c\d+:(.+)$/s)
  try {
    const n = Number(JSON.parse(Buffer.from(sized ? sized[1] : cursor, 'base64url').toString('utf8'))?.next?.start)
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function encodeCursor(map: Record<string, string>): string | null {
  return Object.keys(map).length ? Buffer.from(JSON.stringify(map)).toString('base64url') : null
}

function decodeCursor(cursor: string | undefined): Record<string, string> | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// --- connector ---------------------------------------------------------------

function envKey(): string {
  const key = env.socialfetch.apiKey()
  if (!key) throw new Error('No SocialFetch API key yet. Add one in Settings → Data source.')
  return key
}

/**
 * `getApiKey` is read on every request, so a key saved in Settings takes
 * effect immediately without rebuilding the source.
 */
export function createSocialFetchSource(fetchImpl: Fetch = fetch, getApiKey: () => string = envKey): CompanySource & PeopleSource {
  const get = <T>(path: string, params: Record<string, string | number | undefined>) =>
    request<T>(path, params, fetchImpl, getApiKey())
  const pool = createSearchPool()
  // Companies fetched beyond a page, for the next page of the same search (non-personal).
  const orgPool = createSearchPool<CompanyResult | null>()
  // How a multi-word title's words are joined in `title`: underscores work
  // today, spaces once SocialFetch's fix is out. Until a multi-word search has
  // found someone, one that finds nobody is tried once the other way, and
  // whichever works is kept.
  let titleJoiner: '_' | ' ' = '_'
  let joinerConfirmed = false
  return {
    async searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>> {
      // Industry, size and country are filtered by SocialFetch itself where it
      // can; each page is still checked after it comes back.
      const industry = filters.industry?.trim() ? industryCodes([filters.industry.trim()]) : []
      const geoEntityId = geoIdForCountry(filters.country)
      const start = startFrom(filters.cursor)
      const params = {
        keyword: filters.keyword,
        industry: industry.length ? industry.join(',') : undefined,
        headcountRange: filters.headcount?.length ? filters.headcount.join(',') : undefined,
        geoEntityId: geoEntityId ?? undefined,
      }
      // Each request asks for ORG_FETCH_SIZE (3 credits however many come
      // back); a page shows PAGE_SIZE, and the rest are held for the next.
      let held = orgPool.take(searchPoolKey(params, start))
      let requests = 0
      if (!held) {
        const res = await get<any>('/v2/linkedin/organizations/search', { ...params, count: ORG_FETCH_SIZE, start: start || undefined })
        requests = 1
        const raw: any[] = Array.isArray(res.data?.organizations) ? res.data.organizations : []
        // Unreadable records stay as null, so offsets still line up with SocialFetch's.
        const read = raw.map(mapOrganization)
        const bad = raw.find((_, i) => read[i] === null)
        if (bad) console.warn(`[SocialFetch] ${read.filter((c) => c === null).length}/${raw.length} organizations unreadable; fields: ${describeShape(bad)}`)
        const page = res.data?.page
        held = {
          items: read,
          hasMore: Boolean(page?.hasMore) && raw.length > 0,
          end: (num(page?.start) ?? start) + (num(page?.returnedCount) ?? raw.length),
          // How many companies match in all (SocialFetch counts up to 1,000).
          reportedTotal: num(res.data?.reportedTotal) ?? num(page?.total),
          at: Date.now(),
        }
      }
      const pageHits = held.items.slice(0, PAGE_SIZE)
      const rest = held.items.slice(PAGE_SIZE)
      const nextStart = rest.length ? start + pageHits.length : held.end
      orgPool.put(searchPoolKey(params, nextStart), { ...held, items: rest })
      const more = rest.length > 0 || (held.hasMore && nextStart <= MAX_START)
      const mapped = pageHits.filter((c): c is CompanyResult => c !== null)

      // What SocialFetch filtered isn't re-checked: search results often have
      // no headcount or country, and sub-industries have their own names.
      const filtered = mapped.filter(
        (c) =>
          (industry.length > 0 || !filters.industry?.trim() || norm(c.industry).includes(norm(filters.industry))) &&
          (filters.headcount?.length ? true : inHeadcountBuckets(c.headcount, [])) &&
          (geoEntityId ? true : matchesCountry(c.country, filters.country)),
      )

      // Dedupe by domain (falling back to ref) — subsidiaries and regional
      // pages often share one website.
      const seen = new Set<string>()
      const items = filtered.filter((c) => {
        const key = c.domain ?? `ref:${c.ref}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const warnings: string[] = []
      const details: string[] = []
      const dropped = mapped.length - filtered.length
      if (dropped > 0) {
        details.push(
          `${dropped} of ${mapped.length} companies on this page didn't match your industry, size or country filters and ${dropped === 1 ? 'is' : 'are'} hidden.`,
        )
      }
      return {
        items,
        nextCursor: more ? `start:${nextStart}` : null,
        reportedTotal: held.reportedTotal,
        warnings,
        details,
        requests,
      }
    },

    async getCompany(ref: string, slug?: string | null): Promise<CompanyResult | null> {
      // "0" (from a search result mapped before idOf dropped it) isn't a company.
      if (!ref || /^0+$/.test(ref)) return null
      const numeric = numericId(ref)
      // The company page by URL costs 1 credit; the organization lookup 6 (by
      // id) or 9 (by slug). The page needs the slug, so without one only the
      // organization lookup can be used.
      const pageSlug = slug ?? (numeric ? null : ref)
      if (pageSlug) {
        try {
          const res = await get<any>('/v1/linkedin/companies', {
            url: `https://www.linkedin.com/company/${encodeURIComponent(pageSlug)}/`,
          })
          if (res.data?.lookupStatus === 'found') {
            const company = mapCompanyPage(res.data, ref)
            if (company) return company
          }
          // A school or other non-company page: fall through to the organization lookup.
        } catch (err) {
          // Out of credits or a bad key won't be fixed by the other endpoint.
          if (err instanceof SocialFetchError && (err.code === 'credits_exhausted' || err.code === 'unauthorized')) throw err
        }
      }
      const res = await get<any>('/v2/linkedin/organizations', numeric ? { id: ref } : { slug: ref })
      if (res.data?.lookupStatus !== 'found') return null
      return mapOrganization(res.data?.organization)
    },

    async searchPeople(company: CompanyRef | null, filters: PeopleFilters): Promise<Page<PersonResult>> {
      const titles = [...new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean))]
      const warnings: string[] = []
      const details: string[] = []
      if (titles.length > MAX_TITLES) {
        warnings.push(`Only the first ${MAX_TITLES} job titles were searched.`)
      }
      const slots = titles.length ? titles.slice(0, MAX_TITLES) : ['']

      // Location is filtered by SocialFetch itself when the country has a known
      // LinkedIn geo id; otherwise it falls back to filtering each page after.
      const wantedCountry = canonicalCountry(filters.country)
      const geoEntityId = geoIdForCountry(filters.country)
      if (filters.country?.trim() && !geoEntityId && !filters.cursor) {
        details.push(
          `"${filters.country.trim()}" isn't in the supported country list, so it's filtered after each page comes back and pages may be thin.`,
        )
      }

      const pageSize = Math.min(50, Math.max(1, Math.round(filters.count ?? PAGE_SIZE)))
      const prior = decodeCursor(filters.cursor)
      // On a follow-up page only titles with a cursor left are re-queried.
      const queries = titleQueries(slots)
      const active = prior ? queries.filter((q) => prior[q.key]) : queries
      if (!filters.cursor) {
        // One note per set of leadership titles: "searched "Sales" and "Revenue"".
        const searched = new Map<string, string[]>()
        for (const q of queries.filter((q) => q.leaders.length)) {
          const asked = q.leaders.map((t) => `"${t}"`).join(' and ')
          searched.set(asked, [...(searched.get(asked) ?? []), `"${q.search}"`])
        }
        for (const [asked, words] of searched) {
          details.push(
            `For ${asked}, searched ${words.join(' and ')} and kept the leaders (Head of, VP, Director and the like): LinkedIn headlines word the same job many ways, so the exact title finds few.`,
          )
        }
      }
      const industry = industryCodes(filters.industries)
      // A chosen company with a LinkedIn id is searched by it; otherwise its
      // name goes in the keyword.
      const companyId = company && numericId(company.ref) ? company.ref : null
      // Several companies at once (found by size first): one comma-separated list.
      const companyIds = filters.companyRefs?.filter(numericId).slice(0, MAX_COMPANIES_PER_SEARCH).join(',') || null


      /**
       * Reads a response's people (allowed fields only), in place: null for an
       * unreadable record, 'off-title' for someone whose headline doesn't name
       * the title searched for (titleMatcher), so no profile is paid for them.
       */
      // Searching inside chosen companies: a headline that names one of them
      // anywhere ("Founder, Acme", "Acme | Co-founder") says where they work,
      // so no profile needs buying to find out. The longest name wins.
      const named = Object.entries(filters.companyNames ?? {})
        .map(([ref, name]) => ({ ref, name, key: companyKey(name) }))
        .filter((c) => c.key.length >= 3)
        .sort((a, b) => b.key.length - a.key.length)
      const namedIn = (headline: string | null) => {
        if (!headline || !named.length) return null
        const h = ` ${companyKey(headline)} `
        return named.find((c) => h.includes(` ${c.key} `)) ?? null
      }

      const readPeople = (res: any, asked: number, fitsTitle: ((headline: string | null) => boolean) | null): Hit[] => {
        const raw: any[] = Array.isArray(res.data?.people) ? res.data.people : []
        console.log(
          `[SocialFetch] people/search returned ${raw.length} of ${asked} (status=${res.data?.lookupStatus ?? '?'}, reported=${num(res.data?.reportedTotal) ?? '?'}, more=${res.data?.page?.hasMore ? 'yes' : 'no'})`,
        )
        const bad = raw.find((r) => !mapPerson(r))
        if (bad) console.warn(`[SocialFetch] unreadable person record; fields: ${describeShape(bad)}`)
        return raw.map((r) => {
          const person = mapPerson(r)
          if (person && fitsTitle && !fitsTitle(str(r?.headline))) return 'off-title'
          const at = person && namedIn(str(r?.headline))
          return at ? { ...person, company: at.name, companyRef: at.ref } : person
        })
      }

      /**
       * One title's people for this page, and where that title carries on (an
       * offset, startFrom). Each request asks for FETCH_SIZE, and the people
       * this page doesn't use are held for the next.
       */
      const fetchTitle = async (query: TitleQuery, position: string | undefined) => {
        const title = query.search
        // The title goes in `title`, which filters; `keyword` only ranks.
        const keyword = [filters.keyword?.trim(), companyId ? null : company?.name].filter(Boolean).join(' ')
        const fitsTitle = query.fits
        const multiWord = /\s/.test(title)
        const titleParam = (joiner: string) => (title ? title.replace(/\s+/g, joiner) : undefined)
        const params = {
          title: titleParam(titleJoiner),
          keyword: keyword || undefined,
          geoEntityId: geoEntityId ?? undefined,
          industry: industry.length ? industry.join(',') : undefined,
          currentCompany: companyId ?? companyIds ?? undefined,
        }
        const start = startFrom(position)
        // Held results are read through the query's own title check, so the key says which.
        const poolKey = (at: number) => searchPoolKey({ ...params, match: query.key }, at)
        let hits: HeldHits | null = pool.take(poolKey(start))
        let requests = 0
        if (!hits) {
          let res = await get<any>('/v2/linkedin/people/search', { ...params, count: FETCH_SIZE, start: start || undefined })
          requests = 1
          const found = (r: any) => (Array.isArray(r.data?.people) ? r.data.people.length : 0)
          if (multiWord && !joinerConfirmed && start === 0) {
            if (found(res) > 0) joinerConfirmed = true
            else {
              const other = titleJoiner === '_' ? ' ' : '_'
              const retry = await get<any>('/v2/linkedin/people/search', { ...params, title: titleParam(other), count: FETCH_SIZE })
              requests = 2
              if (found(retry) > 0) {
                titleJoiner = other
                joinerConfirmed = true
                params.title = titleParam(other)
                res = retry
              }
            }
          }
          const page = res.data?.page
          const people = readPeople(res, FETCH_SIZE, fitsTitle)
          hits = {
            items: people,
            hasMore: Boolean(page?.hasMore),
            end: (num(page?.start) ?? start) + (num(page?.returnedCount) ?? people.length),
            reportedTotal: num(res.data?.reportedTotal),
            at: Date.now(),
          }
        }
        const used = hits.items.slice(0, pageSize).map((p) => (p && p !== 'off-title' ? { ...p } : p))
        const rest = hits.items.slice(pageSize)
        // Part-way through held people, the offset is their place; after the last, SocialFetch's own.
        const nextStart = rest.length ? start + used.length : Math.max(hits.end, start + used.length)
        pool.put(poolKey(nextStart), { ...hits, items: rest })
        const more = used.length > 0 && (rest.length > 0 || hits.hasMore) && nextStart <= MAX_START
        return { title: query.key, people: used, next: more ? `start:${nextStart}` : null, reportedTotal: hits.reportedTotal, requests }
      }

      const settled = await Promise.allSettled(active.map((q) => fetchTitle(q, prior?.[q.key])))

      const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof fetchTitle>>>).value)
      const failed = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[]
      if (ok.length === 0 && failed.length > 0) throw failed[0].reason
      if (failed.length > 0) {
        warnings.push(`${failed.length} of ${active.length} title searches failed: ${failed[0].reason?.message ?? 'unknown error'}`)
      }

      const nextCursors: Record<string, string> = {}
      let reportedTotal: number | null = null
      const people: PersonResult[] = []
      const seen = new Set<string>()
      let wrongCompany = 0
      let unreadable = 0
      let offTitle = 0

      for (const { title, people: found, next, reportedTotal: total } of ok) {
        if (next) nextCursors[title] = next
        if (total !== null) reportedTotal = Math.max(reportedTotal ?? 0, total)
        for (const person of found) {
          if (!person) {
            unreadable++
            continue
          }
          if (person === 'off-title') {
            offTitle++
            continue
          }
          if (seen.has(person.profileUrl)) continue
          seen.add(person.profileUrl)

          if (company) {
            const headlineNamesIt = norm(person.title).includes(norm(company.name))
            const matches =
              (person.companyRef && person.companyRef === company.ref) ||
              (person.company && sameCompanyName(person.company, company.name)) ||
              headlineNamesIt
            if (matches) {
              person.company = company.name
              person.companyRef = company.ref
            } else if (person.companyRef || person.company) {
              // Their known employer is somewhere else.
              wrongCompany++
              continue
            }
            // Otherwise the employer is unknown; it's looked up on save rather
            // than assumed to be the chosen company.
          }
          people.push(person)
        }
      }

      // Never drop records silently: a shape change would otherwise look like
      // "no results".
      if (unreadable > 0) {
        details.push(
          `${people_(unreadable)} returned by the search ${unreadable === 1 ? 'was' : 'were'} missing a name or profile link and ${unreadable === 1 ? 'was' : 'were'} skipped.`,
        )
      }
      if (offTitle > 0) {
        details.push(
          `${people_(offTitle)} returned by the search ${offTitle === 1 ? "doesn't" : "don't"} have the job title in their headline and ${offTitle === 1 ? 'was' : 'were'} left out, before any profile was paid for.`,
        )
      }
      if (wrongCompany > 0) {
        details.push(
          `${people_(wrongCompany)} returned by the search ${wrongCompany === 1 ? "doesn't" : "don't"} currently work at ${company?.name} and ${wrongCompany === 1 ? 'was' : 'were'} hidden.` +
            (wrongCompany > people.length ? ' The company filter may not be applied as expected.' : ''),
        )
      }

      if (geoEntityId && wantedCountry) {
        // SocialFetch already filtered by location. Check it did what we
        // asked: only labels that name a known country can disagree.
        const elsewhere = people.filter((p) => {
          const c = canonicalCountry(p.country)
          return c !== null && c !== wantedCountry
        }).length
        if (people.length >= 5 && elsewhere > people.length / 2) {
          details.push(`Most results aren't in ${wantedCountry}. The location filter for it may be wrong; please report this.`)
        }
        // City-only labels ("Exeter") get the searched country.
        for (const p of people) if (!canonicalCountry(p.country)) p.country = wantedCountry
      }

      const filtered = people.filter(
        (p) =>
          (!filters.seniorities?.length || (p.seniority !== null && filters.seniorities.includes(p.seniority))) &&
          (geoEntityId ? true : matchesCountry(p.country, filters.country)),
      )
      const hidden = people.length - filtered.length
      if (hidden > 0) {
        details.push(`${people_(hidden)} didn't match your seniority or country filters and ${hidden === 1 ? 'is' : 'are'} hidden.`)
      }

      return {
        items: filtered,
        nextCursor: encodeCursor(nextCursors),
        reportedTotal,
        warnings,
        details,
        requests: ok.reduce((n, t) => n + t.requests, 0),
        funnel: { hits: ok.reduce((n, t) => n + t.people.length, 0), offTitle, filteredOut: hidden },
      }
    },

    async getPerson(profileRef: string): Promise<PersonResult | null> {
      const res = await get<any>('/v2/linkedin/profiles', { handle: profileRef })
      if (res.data?.lookupStatus !== 'found') return null
      const person = mapPerson(res.data?.profile)
      // Log field names (never values) if no current job came through at
      // all, so a change in the response can be fixed rather than guessed at.
      // (A current job without a company page is normal.)
      if (person && !person.companyRef && !person.company && !res.data?.profile?.currentPositions?.length) {
        console.warn(`[SocialFetch] profile without a current position; fields: ${describeShape(res.data?.profile)}`)
      }
      return person
    },
  }
}

/**
 * Credit balance for a key (a free call). Throws SocialFetch's own error, so it
 * doubles as the "Test connection" check for a key.
 */
export async function getSocialFetchBalance(apiKey: string, fetchImpl: Fetch = fetch): Promise<number | null> {
  const res = await request<{ balance?: number }>('/v1/balance', {}, fetchImpl, apiKey)
  return num(res.data?.balance)
}
