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
// Confirmed against the live API (2026-09-25): people search matches on
// `keyword`; adding `title` returns zero results, so job titles are sent as
// keywords. Search hits carry only name, profile URL, headline and a free-text
// `location` (no positions, employer or structured country), and page by
// offset (`start`) rather than cursor.
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
const TIMEOUT_MS = 25_000
const MAX_ATTEMPTS = 3
// Several titles become one request each (the API takes a single `title`).
const MAX_TITLES = 5
// SocialFetch's documented maximum for `start`.
const MAX_START = 999
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
    // and is not charged. 500/502 are not charged either (502 is SocialFetch's
    // normalisation failure), so a retry costs nothing.
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
function idOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return str(v)
}

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
    country: null,
    linkedinUrl: str(c?.url) ?? null,
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
export function sameCompanyName(a: string, b: string): boolean {
  const clean = (s: string) =>
    norm(s)
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\b(ltd|limited|llc|inc|plc|gmbh|corp|corporation|co|group|holdings|the)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const ca = clean(a)
  const cb = clean(b)
  return Boolean(ca && cb && (ca === cb || ca.startsWith(`${cb} `) || cb.startsWith(`${ca} `)))
}

// --- composite cursors -------------------------------------------------------
// Multi-title people search runs one paged request per title. The cursor handed
// back to the client carries every per-title position; exhausted titles drop out.
// A position is `start:N` (an offset, which works with any page size) or, when
// SocialFetch only offers its own cursor, `c<size>:<cursor>`: SocialFetch
// rejects a cursor reused with a different page size ("Pagination cursor does
// not match this request"), so the size it was made with travels with it.

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
  return {
    async searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>> {
      // Industry, size and country are filtered by SocialFetch itself where it
      // can; each page is still checked after it comes back.
      const industry = filters.industry?.trim() ? industryCodes([filters.industry.trim()]) : []
      const geoEntityId = geoIdForCountry(filters.country)
      const res = await get<any>('/v2/linkedin/organizations/search', {
        keyword: filters.keyword,
        count: PAGE_SIZE,
        cursor: filters.cursor,
        industry: industry.length ? industry.join(',') : undefined,
        headcountRange: filters.headcount?.length ? filters.headcount.join(',') : undefined,
        geoEntityId: geoEntityId ?? undefined,
      })
      const raw: any[] = Array.isArray(res.data?.organizations) ? res.data.organizations : []
      const mapped = raw.map(mapOrganization).filter((c): c is CompanyResult => c !== null)
      if (mapped.length < raw.length) {
        const bad = raw.find((o) => mapOrganization(o) === null)
        console.warn(`[SocialFetch] ${raw.length - mapped.length}/${raw.length} organizations unreadable; fields: ${describeShape(bad)}`)
      }

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
        nextCursor: res.data?.page?.hasMore ? str(res.data?.page?.nextCursor) : null,
        reportedTotal: num(res.data?.reportedTotal),
        warnings,
        details,
      }
    },

    async getCompany(ref: string, slug?: string | null): Promise<CompanyResult | null> {
      const numeric = /^\d+$/.test(ref)
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
      const active = prior ? slots.filter((t) => prior[t]) : slots
      const industry = industryCodes(filters.industries)
      // A chosen company with a LinkedIn id is searched by it; otherwise its
      // name goes in the keyword.
      const companyId = company && /^\d+$/.test(company.ref) ? company.ref : null
      // Several companies at once (found by size first): one comma-separated list.
      const companyIds = filters.companyRefs?.filter((r) => /^\d+$/.test(r)).slice(0, MAX_COMPANIES_PER_SEARCH).join(',') || null


      const settled = await Promise.allSettled(
        active.map((title) => {
          const position = prior?.[title]
          const start = position?.startsWith('start:') ? Number(position.slice(6)) : undefined
          const sized = position?.match(/^c(\d+):(.+)$/s)
          const cursor = start !== undefined ? undefined : sized ? sized[2] : position
          // A cursor only works with the page size it was made with.
          const count = sized ? Number(sized[1]) : pageSize
          // Titles go in `keyword`: the `title` parameter returns no results.
          const keyword = [title, filters.keyword?.trim(), companyId ? null : company?.name].filter(Boolean).join(' ')
          return get<any>('/v2/linkedin/people/search', {
            keyword: keyword || undefined,
            geoEntityId: geoEntityId ?? undefined,
            industry: industry.length ? industry.join(',') : undefined,
            currentCompany: companyId ?? companyIds ?? undefined,
            count,
            start,
            cursor,
          }).then((res) => ({ title, res, start: start ?? 0, count }))
        }),
      )

      const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => (s as PromiseFulfilledResult<any>).value)
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

      for (const { title, res, start, count } of ok) {
        const page = res.data?.page
        if (page?.hasMore) {
          const cursor = str(page.nextCursor)
          const returned = num(page.returnedCount) ?? (Array.isArray(res.data?.people) ? res.data.people.length : 0)
          const nextStart = (num(page.start) ?? start) + returned
          // Offsets work with any page size, so a short top-up page or a
          // bigger "Load more" can follow on; prefer them when SocialFetch
          // pages by offset.
          const offsetPaged = page.kind === 'offset' || num(page.start) !== null
          if (offsetPaged && returned > 0 && nextStart <= MAX_START) nextCursors[title] = `start:${nextStart}`
          else if (cursor) nextCursors[title] = `c${count}:${cursor}`
          else if (returned > 0 && nextStart <= MAX_START) nextCursors[title] = `start:${nextStart}`
        }
        const total = num(res.data?.reportedTotal)
        if (total !== null) reportedTotal = Math.max(reportedTotal ?? 0, total)

        const rawPeople: any[] = Array.isArray(res.data?.people) ? res.data.people : []
        console.log(
          `[SocialFetch] people/search returned ${rawPeople.length} of ${count} (status=${res.data?.lookupStatus ?? '?'}, reported=${total ?? '?'}, more=${page?.hasMore ? 'yes' : 'no'})`,
        )
        for (const raw of rawPeople) {
          const person = mapPerson(raw)
          if (!person) {
            if (unreadable++ === 0) console.warn(`[SocialFetch] unreadable person record; fields: ${describeShape(raw)}`)
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

      return { items: filtered, nextCursor: encodeCursor(nextCursors), reportedTotal, warnings, details }
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
