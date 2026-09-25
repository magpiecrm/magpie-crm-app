// SocialFetch connector (https://api.socialfetch.dev, `x-api-key` auth).
//
// Endpoints used, all confirmed against SocialFetch's published OpenAPI spec
// and llms.json route inventory:
//   GET /v2/linkedin/organizations/search  keyword (required), count, cursor   3 credits
//   GET /v2/linkedin/organizations         id | slug                          6-9 credits
//   GET /v2/linkedin/people/search         title, currentCompany, keyword,    3 credits
//                                          count, cursor
//   GET /v2/linkedin/profiles              handle                             3 credits
//   GET /v1/balance                        (free)
//
// The docs give no value format for `currentCompany`, `industry`,
// `headcountRange` or `geoEntityId`, and there is no endpoint to resolve a
// place name to a `geoEntityId`. So this connector sends only parameters whose
// meaning is unambiguous and applies industry, headcount, country and
// seniority as post-filters over what comes back. `currentCompany` is sent as
// the numeric org id, and results are checked against the chosen company so a
// wrong guess about its format shows up as a warning, not as wrong people.

import { env } from '../env'
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
  throw new SocialFetchError('SocialFetch did not respond. Try again shortly.', 0, 'unavailable')
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
  if (status === 401 || status === 403) {
    return new SocialFetchError('SocialFetch rejected the API key. Check it in Settings → Prospecting.', status, 'unauthorized')
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

  // Search hits sometimes carry only a headline; it is the best title we have.
  const title = str(current?.title) ?? str(p?.headline) ?? ''
  return {
    profileUrl,
    firstName,
    lastName,
    title,
    seniority: classifySeniority(title),
    company: str(current?.organizationName) ?? str(current?.organization?.name) ?? '',
    companyRef: str(current?.organizationId) ?? str(current?.organization?.id) ?? null,
    companyDomain: null,
    country: str(p?.geo?.country) ?? str(p?.geoCountry) ?? null,
    source: SOURCE,
  }
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
  return norm(value).includes(norm(wanted)) || norm(wanted).includes(norm(value) || '\u0000')
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
// back to the client carries every per-title cursor; exhausted titles drop out.

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
  if (!key) throw new Error('No SocialFetch API key yet. Add one in Settings → Prospecting.')
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
      const res = await get<any>('/v2/linkedin/organizations/search', {
        keyword: filters.keyword,
        count: PAGE_SIZE,
        cursor: filters.cursor,
      })
      const raw: any[] = Array.isArray(res.data?.organizations) ? res.data.organizations : []
      const mapped = raw.map(mapOrganization).filter((c): c is CompanyResult => c !== null)

      const filtered = mapped.filter(
        (c) =>
          (!filters.industry?.trim() || norm(c.industry).includes(norm(filters.industry))) &&
          inHeadcountBuckets(c.headcount, filters.headcount ?? []) &&
          matchesCountry(c.country, filters.country),
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
      const dropped = mapped.length - filtered.length
      if (dropped > 0) {
        warnings.push(
          `${dropped} of ${mapped.length} companies on this page didn't match your industry, size or country filters and ${dropped === 1 ? 'is' : 'are'} hidden.`,
        )
      }
      return {
        items,
        nextCursor: res.data?.page?.hasMore ? str(res.data?.page?.nextCursor) : null,
        reportedTotal: num(res.data?.reportedTotal),
        warnings,
      }
    },

    async getCompany(ref: string): Promise<CompanyResult | null> {
      const params = /^\d+$/.test(ref) ? { id: ref } : { slug: ref }
      const res = await get<any>('/v2/linkedin/organizations', params)
      if (res.data?.lookupStatus !== 'found') return null
      return mapOrganization(res.data?.organization)
    },

    async searchPeople(company: CompanyRef | null, filters: PeopleFilters): Promise<Page<PersonResult>> {
      const titles = [...new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean))]
      const warnings: string[] = []
      if (titles.length > MAX_TITLES) {
        warnings.push(`Only the first ${MAX_TITLES} job titles were searched.`)
      }
      const slots = titles.length ? titles.slice(0, MAX_TITLES) : ['']

      const prior = decodeCursor(filters.cursor)
      // On a follow-up page only titles with a cursor left are re-queried.
      const active = prior ? slots.filter((t) => prior[t]) : slots

      const settled = await Promise.allSettled(
        active.map((title) =>
          get<any>('/v2/linkedin/people/search', {
            title: title || undefined,
            keyword: filters.keyword?.trim() || undefined,
            // UNCONFIRMED: the docs don't say whether this takes an org id
            // or a name. Results are checked against the company below.
            currentCompany: company?.ref,
            count: PAGE_SIZE,
            cursor: prior?.[title],
          }).then((res) => ({ title, res })),
        ),
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

      for (const { title, res } of ok) {
        const next = res.data?.page?.hasMore ? str(res.data?.page?.nextCursor) : null
        if (next) nextCursors[title] = next
        const total = num(res.data?.reportedTotal)
        if (total !== null) reportedTotal = Math.max(reportedTotal ?? 0, total)

        for (const raw of Array.isArray(res.data?.people) ? res.data.people : []) {
          const person = mapPerson(raw)
          if (!person || seen.has(person.profileUrl)) continue
          seen.add(person.profileUrl)

          if (company) {
            const known = person.companyRef || person.company
            const matches =
              (person.companyRef && person.companyRef === company.ref) ||
              (person.company && sameCompanyName(person.company, company.name))
            if (known && !matches) {
              wrongCompany++
              continue
            }
            // No position data at all: trust the currentCompany filter.
            if (!person.company) person.company = company.name
            if (!person.companyRef) person.companyRef = company.ref
          }
          people.push(person)
        }
      }

      if (wrongCompany > 0) {
        warnings.push(
          `${people_(wrongCompany)} returned by SocialFetch ${wrongCompany === 1 ? "doesn't" : "don't"} currently work at ${company?.name} and ${wrongCompany === 1 ? 'was' : 'were'} hidden.` +
            (wrongCompany > people.length ? ' The company filter may not be applied as expected.' : ''),
        )
      }

      const filtered = people.filter(
        (p) =>
          (!filters.seniorities?.length || (p.seniority !== null && filters.seniorities.includes(p.seniority))) &&
          matchesCountry(p.country, filters.country),
      )
      const hidden = people.length - filtered.length
      if (hidden > 0) {
        warnings.push(`${people_(hidden)} didn't match your seniority or country filters and ${hidden === 1 ? 'is' : 'are'} hidden.`)
      }

      return { items: filtered, nextCursor: encodeCursor(nextCursors), reportedTotal, warnings }
    },

    async getPerson(profileRef: string): Promise<PersonResult | null> {
      const res = await get<any>('/v2/linkedin/profiles', { handle: profileRef })
      if (res.data?.lookupStatus !== 'found') return null
      return mapPerson(res.data?.profile)
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
