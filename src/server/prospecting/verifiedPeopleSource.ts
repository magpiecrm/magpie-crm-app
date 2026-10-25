// Verified people search (Stage 2). When the host has it on
// (hostRules.ts hostVerifiedPeopleSearch), a people search is answered by the
// host's liscrape search over OpenSERP: it finds LinkedIn profiles by job title
// and confirms each against the live profile (title mask, location, employer
// industry/size) before returning them. It's slower than the index/web path —
// minutes, streamed — but every person is checked, so the funnel is simple
// (no off-title, no enrichment, no wrong-company): the people come back ready.
//
// It talks to the host over the SocialFetch channel (SOCIALFETCH_BASE_URL +
// x-api-key), which the relay proxies to liscrape's async people API
// (start -> poll -> done). search.ts delegates here, so allowance, the search
// log, usage and streaming all stay in one place.

import { env } from '../env'
import { requireSocialFetchKey } from './settings'
import { classifySeniority } from './seniority'
import { logSearch, newSearchId } from './searchLog'
import { HEADCOUNT_BUCKETS, type HeadcountBucket, type Page, type PeopleFilters, type PersonResult } from './types'

/** How long to keep polling one search before returning what it has. */
const MAX_WAIT_MS = 7 * 60_000
const POLL_EVERY_MS = 4_000
const DEFAULT_COUNT = 25

/** App size buckets (HEADCOUNT_BUCKETS) -> liscrape size bands (SIZE_BANDS). */
const BUCKET_TO_BANDS: Record<string, string[]> = {
  '1-10': ['1', '2-10'],
  '11-50': ['11-50'],
  '51-200': ['51-200'],
  '201-500': ['201-500'],
  '501-1000': ['501-1000'],
  '1001-5000': ['1001-5000'],
  '5001-10000': ['5001-10000'],
  '10001+': ['10001+'],
}
/** liscrape band -> the app's bucket (1 and 2-10 both fall in 1-10). */
function bandToBucket(band: string | null): HeadcountBucket | undefined {
  if (!band) return undefined
  if (band === '1' || band === '2-10') return '1-10'
  return (HEADCOUNT_BUCKETS as readonly string[]).includes(band) ? (band as HeadcountBucket) : undefined
}

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/)
  return [parts[0] ?? '', parts.slice(1).join(' ')]
}

/** Bare registrable host from a website URL, e.g. "https://www.acme.co/x" -> "acme.co". Null when unusable. */
function hostOf(website: string | null): string | null {
  if (!website) return null
  try {
    const h = new URL(website.includes('://') ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, '')
    return h.includes('.') ? h : null
  } catch {
    return null
  }
}

/** The host relay's minimised person (liscrapeSource.ts toPerson). */
interface HostPerson {
  profileUrl: string
  name: string
  title: string
  titleVerified: boolean
  country: string | null
  company: { name: string; slug: string | null; url: string | null; industry: string | null; sizeBand: string | null; employees: number | null; website: string | null } | null
}

/** One host person -> a PersonResult carrying only the fields the UI and save/reveal use. */
function mapPerson(row: HostPerson, searchId: string): PersonResult {
  const [firstName, lastName] = splitName(row.name)
  const c = row.company
  return {
    profileUrl: row.profileUrl,
    firstName,
    lastName,
    title: row.title,
    seniority: classifySeniority(row.title),
    company: c?.name ?? '',
    companyRef: c?.slug ?? null,
    companySlug: c?.slug ?? null,
    companyDomain: hostOf(c?.website ?? null),
    country: row.country,
    source: 'web',
    // The title was confirmed against the live profile's mask.
    titleExact: row.titleVerified,
    // liscrape already confirmed the employer against the live profile, so saving needn't pay to look it up again.
    profileChecked: true,
    ...(c?.sizeBand ? { companySize: bandToBucket(c.sizeBand) } : {}),
    ...(c ? {} : { noCompany: true }),
    searchId,
  }
}

interface HostCalls {
  start: (body: unknown) => Promise<{ id: string } | null>
  poll: (id: string, cursor: number) => Promise<{ status: string; found: number; nextCursor: number | null; people: HostPerson[] } | null>
}

/** The host relay calls over the SocialFetch channel (default), overridable for tests. */
function hostCalls(fetchImpl: typeof fetch): HostCalls {
  const base = env.socialfetch.baseUrl()
  const headers = () => ({ 'x-api-key': requireSocialFetchKey(), accept: 'application/json' })
  return {
    async start(body) {
      const res = await fetchImpl(new URL('/v2/linkedin/people/searches', base), {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) return null
      const j = (await res.json()) as { id?: string }
      return j.id ? { id: j.id } : null
    },
    async poll(id, cursor) {
      const url = new URL(`/v2/linkedin/people/searches/${encodeURIComponent(id)}`, base)
      url.searchParams.set('cursor', String(cursor))
      url.searchParams.set('limit', '50')
      const res = await fetchImpl(url, { headers: headers(), signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return null
      const j = (await res.json()) as { status?: string; found?: number; next_cursor?: number | null; nextCursor?: number | null; people?: HostPerson[] }
      return {
        status: j.status ?? 'running',
        found: typeof j.found === 'number' ? j.found : 0,
        nextCursor: j.next_cursor ?? j.nextCursor ?? null,
        people: Array.isArray(j.people) ? j.people : [],
      }
    },
  }
}

export interface VerifiedDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Override the host transport (tests). */
  calls?: HostCalls
}

/**
 * Runs a verified people search to completion (or until `count` people or the
 * time cap), streaming each batch through `onPeople`. Returns the same
 * Page shape search.ts returns, so the UI and callers are unchanged.
 */
export async function verifiedPeopleSearch(
  input: PeopleFilters & { company?: { ref: string; name: string } | null },
  opts: { onPeople?: (found: { items: PersonResult[]; refined: string[] }) => void } = {},
  deps: VerifiedDeps = {},
): Promise<Page<PersonResult> & { refined: string[]; resumed: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const calls = deps.calls ?? hostCalls(fetchImpl)

  const { remaining, requireAllowance } = await import('../allowance')
  if (remaining('prospects') < 1) requireAllowance('prospects')

  const titles = (input.titles ?? []).map((t) => t.trim()).filter(Boolean)
  const count = Math.max(1, input.count ?? DEFAULT_COUNT)
  const empty = (warnings: string[] = []): Page<PersonResult> & { refined: string[]; resumed: boolean } => ({
    items: [],
    nextCursor: null,
    reportedTotal: 0,
    warnings,
    details: [],
    requests: 1,
    refined: [],
    resumed: false,
  })
  if (!titles.length) return empty()

  const searchId = newSearchId()
  const startedAt = now()
  const sizes = [...new Set((input.companySizes ?? []).flatMap((b) => BUCKET_TO_BANDS[b] ?? []))]
  const body = {
    titles,
    locations: input.country?.trim() ? [input.country.trim()] : [],
    industries: input.industries ?? [],
    sizes,
    limit: count,
  }

  const started = await calls.start(body).catch(() => null)
  if (!started) return empty(['Verified people search is busy right now — try again in a moment.'])

  const items: PersonResult[] = []
  const seen = new Set<string>()
  let cursor = 0
  let found = 0
  let status = 'running'
  let stop = 'done'
  while (now() - startedAt < MAX_WAIT_MS && items.length < count) {
    const page = await calls.poll(started.id, cursor).catch(() => null)
    if (!page) {
      stop = 'source failed'
      break
    }
    found = page.found
    const batch: PersonResult[] = []
    for (const row of page.people) {
      if (!row?.profileUrl || seen.has(row.profileUrl)) continue
      seen.add(row.profileUrl)
      const person = mapPerson(row, searchId)
      items.push(person)
      batch.push(person)
      if (items.length >= count) break
    }
    if (page.nextCursor != null) cursor = page.nextCursor
    if (batch.length) opts.onPeople?.({ items: batch, refined: [] })
    status = page.status
    if (status !== 'running') {
      stop = status === 'done' ? 'done' : status
      break
    }
    if (items.length >= count) break
    await sleep(POLL_EVERY_MS)
  }

  await logSearch({
    id: searchId,
    at: new Date(startedAt).toISOString(),
    ms: now() - startedAt,
    filters: {
      titles,
      seniorities: input.seniorities ?? [],
      industries: input.industries ?? [],
      sizes: input.companySizes ?? [],
      country: input.country?.trim() || null,
      company: null,
      keyword: Boolean(input.keyword?.trim()),
      page: 'first',
    },
    counts: { hits: found, shown: items.length },
    stop,
  })

  const { recordUsage } = await import('../usage')
  recordUsage({ searches: 1, prospects: items.length, prospectCredits: items.length, searchShown: items.length, searchHits: found })

  return {
    items,
    nextCursor: null,
    reportedTotal: found,
    warnings: [],
    details: [],
    requests: 1,
    refined: [],
    resumed: false,
  }
}
