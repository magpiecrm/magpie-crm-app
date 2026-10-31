// Verified people search (Stage 2). When the host has it on
// (hostRules.ts hostVerifiedPeopleSearch), a people search is answered by the
// host's liscrape search over OpenSERP: it finds LinkedIn profiles by job title
// and confirms each against the live profile (title mask, location, employer
// industry/size) before returning them. It's slower than the index/web path —
// minutes, streamed — but every person is checked, so there's no off-title,
// enrichment or wrong-company. Each batch still goes through search.ts's funnel
// (verifiedFunnel) before it's shown, and more people are asked for than the
// page wants, since that leaves out about half of them or more. A country
// also searches its cities, a few at a time (searchPlaces.ts).
//
// It talks to the host over the SocialFetch channel (SOCIALFETCH_BASE_URL +
// x-api-key), which the relay proxies to liscrape's async people API
// (start -> poll -> done). search.ts delegates here, so allowance, the search
// log, usage and streaming all stay in one place.

import { env } from '../env'
import { requireSocialFetchKey } from './settings'
import { classifySeniority } from './seniority'
import { logSearch, newSearchId } from './searchLog'
import type { PlacesPlan } from './searchPlaces'
import { HEADCOUNT_BUCKETS, type HeadcountBucket, type Page, type PeopleFilters, type PersonResult } from './types'

/** How long to keep polling one search before returning what it has. */
const MAX_WAIT_MS = 7 * 60_000
const POLL_EVERY_MS = 4_000
const POLL_SIZE = 50
const DEFAULT_COUNT = 25
/**
 * People asked of the host for each the page wants: the funnel hid 44-53% of
 * those found before this search, and 16 of its first 21 (hq, 2026-10). The
 * search is cancelled once the page is full, so this is only ever a ceiling.
 * The host charges a search by what the page wants, not this (the cloud's
 * liscrapeSource.ts ASKED_PER_SHOWN).
 */
const ASKED_PER_SHOWN = 4
/** Most people one search can ask for (the cloud's liscrapeSource.ts MAX_LIMIT). */
const MAX_ASKED = 200
/**
 * Batches of cities one search works through to fill its page, while someone's
 * watching. A narrow filter gives few people a batch, and fewer each time
 * (14, 10 and 3 new on hq's filters, 2026-10-31), so a fourth isn't worth its
 * proxy data: Load more takes up where this stops.
 */
const MAX_ROUNDS = 3
/** No further batch is started after this long, so a search ends within about 15 minutes. */
const NO_NEW_ROUND_AFTER_MS = 8 * 60_000

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
  /** Found on their company's website rather than a profile (the host's sitefounders). */
  fromWebsite?: boolean
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
    // Someone found on a company's own site has no profile to look up, and works where the site says.
    profileChecked: true,
    ...(row.fromWebsite ? { fromWebsite: true } : {}),
    ...(c?.sizeBand ? { companySize: bandToBucket(c.sizeBand) } : {}),
    ...(c ? {} : { noCompany: true }),
    searchId,
  }
}

/** What the host's search did, for the search log: counts and fixed reasons, nobody's details. */
interface HostStats {
  searches: number
  engineErrors: number
  siteIgnored: number
  candidates: number
  rejected: Record<string, number>
}

interface HostPage {
  status: string
  found: number
  nextCursor: number | null
  people: HostPerson[]
  stats?: HostStats | null
}

interface HostCalls {
  start: (body: unknown) => Promise<{ id: string } | null>
  poll: (id: string, cursor: number) => Promise<HostPage | null>
  cancel?: (id: string) => Promise<unknown>
}

function addStats(a: HostStats | null, b: HostStats | null): HostStats | null {
  if (!a || !b) return a ?? b
  const rejected = { ...a.rejected }
  for (const [why, n] of Object.entries(b.rejected ?? {})) rejected[why] = (rejected[why] ?? 0) + n
  return {
    searches: a.searches + b.searches,
    engineErrors: a.engineErrors + b.engineErrors,
    siteIgnored: a.siteIgnored + b.siteIgnored,
    candidates: a.candidates + b.candidates,
    rejected,
  }
}

function statCounts(stats: HostStats | null): Record<string, number> {
  if (!stats) return {}
  return {
    serpSearches: stats.searches,
    serpErrors: stats.engineErrors,
    serpSiteIgnored: stats.siteIgnored,
    candidates: stats.candidates,
    ...Object.fromEntries(Object.entries(stats.rejected ?? {}).map(([why, n]) => [`rejected: ${why}`, n])),
  }
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
      url.searchParams.set('limit', String(POLL_SIZE))
      const res = await fetchImpl(url, { headers: headers(), signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return null
      const j = (await res.json()) as { status?: string; found?: number; next_cursor?: number | null; nextCursor?: number | null; people?: HostPerson[]; stats?: HostStats | null }
      return {
        status: j.status ?? 'running',
        found: typeof j.found === 'number' ? j.found : 0,
        nextCursor: j.next_cursor ?? j.nextCursor ?? null,
        people: Array.isArray(j.people) ? j.people : [],
        stats: j.stats ?? null,
      }
    },
    async cancel(id) {
      await fetchImpl(new URL(`/v2/linkedin/people/searches/${encodeURIComponent(id)}`, base), {
        method: 'DELETE',
        headers: headers(),
        signal: AbortSignal.timeout(15_000),
      })
    },
  }
}

/** What's done to the host's people before they're shown (search.ts verifiedFunnel). */
export interface VerifiedFunnel {
  /** One batch made ready to show: some left out, and those who can't be verified marked. */
  prepare(people: PersonResult[]): Promise<PersonResult[]>
  /** Marked, and hidden by the page: doesn't fill it, and isn't charged for. */
  hidden(person: PersonResult): boolean
  /** Whose email is likeliest to be found, first, for when there's less room than people. */
  findableFirst(people: PersonResult[]): PersonResult[]
  /** The cities this batch of the search takes in its country (searchPlaces.ts). */
  plan: Pick<PlacesPlan, 'places' | 'placesOnly'>
  /** Moves `plan` on to the next cities; false where there are none. */
  nextRound(): boolean
  /** Everyone the search kept, and whether it ran: what the funnel did, for the log, usage and the page, and where the next search takes up. */
  finish(items: PersonResult[], ran: boolean): { counts: Record<string, number>; usage: Parameters<typeof import('../usage').recordUsage>[0]; details: string[]; resumed: boolean; nextCursor: string | null }
}

const NO_FUNNEL: VerifiedFunnel = {
  prepare: async (people) => people,
  hidden: () => false,
  findableFirst: (people) => people,
  plan: { places: [], placesOnly: false },
  nextRound: () => false,
  finish: () => ({ counts: {}, usage: {}, details: [], resumed: false, nextCursor: null }),
}

export interface VerifiedDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Override the host transport (tests). */
  calls?: HostCalls
  funnel?: VerifiedFunnel
}

/**
 * Runs a verified people search to completion (or until `count` people worth
 * showing or the time cap), streaming each batch through `onPeople`, and
 * cancels it at the host if it's still going. Where the page isn't full and
 * `listening` says someone's still there, it goes on to the country's next
 * cities, up to MAX_ROUNDS, stopping early at cities that find nobody. Returns
 * the same Page shape search.ts returns, so the UI and callers are unchanged.
 */
export async function verifiedPeopleSearch(
  input: PeopleFilters & { company?: { ref: string; name: string } | null },
  opts: { onPeople?: (found: { items: PersonResult[]; refined: string[] }) => void; listening?: () => boolean } = {},
  deps: VerifiedDeps = {},
): Promise<Page<PersonResult> & { refined: string[]; resumed: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const calls = deps.calls ?? hostCalls(fetchImpl)
  const funnel = deps.funnel ?? NO_FUNNEL

  const { remaining, requireAllowance } = await import('../allowance')
  const left = remaining('prospects')
  if (left < 1) requireAllowance('prospects')

  const titles = (input.titles ?? []).map((t) => t.trim()).filter(Boolean)
  // A credit per person shown, so a page asks for no more than are left.
  const count = Math.min(Math.max(1, input.count ?? DEFAULT_COUNT), Math.floor(left))
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
  const body = () => ({
    titles,
    locations: input.country?.trim() ? [input.country.trim()] : [],
    industries: input.industries ?? [],
    sizes,
    ...(funnel.plan.places.length ? { places: funnel.plan.places, placesOnly: funnel.plan.placesOnly } : {}),
    // The host also reads company websites, where it runs that and the filter suits it.
    founderSites: true,
    limit: Math.min(MAX_ASKED, (count - usable()) * ASKED_PER_SHOWN),
  })

  const items: PersonResult[] = []
  const seen = new Set<string>()
  // Hidden people don't fill the page.
  const usable = () => items.filter((p) => !funnel.hidden(p)).length
  const resumedSearch = funnel.plan.placesOnly
  let found = 0
  let stats: HostStats | null = null
  let places = 0
  let rounds = 0
  let stop = 'time limit'
  let roundFound = 0

  /** Makes `people` ready and adds them to the page, as far as there's room. */
  const take = async (people: PersonResult[]) => {
    const ready = people.length ? await funnel.prepare(people) : []
    // When there's less room than people, those whose email is likeliest to be found take it.
    const chosen = new Set(funnel.findableFirst(ready.filter((p) => !funnel.hidden(p))).slice(0, Math.max(0, count - usable())).map((p) => p.profileUrl))
    const taken = ready.filter((p) => funnel.hidden(p) || chosen.has(p.profileUrl))
    items.push(...taken)
    if (taken.length) opts.onPeople?.({ items: taken, refined: [] })
  }

  /** One batch of cities, to the end of its host search; false if it couldn't start. */
  const runRound = async (): Promise<boolean> => {
    const started = await calls.start(body()).catch(() => null)
    if (!started) return false
    rounds++
    places += funnel.plan.places.length
    const roundStartedAt = now()
    const earlierFound = found
    const earlierStats = stats
    let cursor = 0
    let status = 'running'
    roundFound = 0
    // Wait for the end of the batch: they only take the room those with a live profile leave.
    const fromWebsite: PersonResult[] = []
    stop = 'time limit'
    try {
      while (now() - roundStartedAt < MAX_WAIT_MS && usable() < count) {
        const page = await calls.poll(started.id, cursor).catch(() => null)
        if (!page) {
          stop = 'source failed'
          break
        }
        roundFound = page.found
        found = earlierFound + page.found
        stats = addStats(earlierStats, page.stats ?? null)
        status = page.status
        if (page.nextCursor != null) cursor = page.nextCursor
        const fresh: PersonResult[] = []
        for (const row of page.people) {
          if (!row?.profileUrl || seen.has(row.profileUrl)) continue
          seen.add(row.profileUrl)
          const person = mapPerson(row, searchId)
          ;(person.fromWebsite ? fromWebsite : fresh).push(person)
        }
        await take(fresh)
        if (usable() >= count) {
          stop = 'full'
          break
        }
        // Finished at the host, with nothing left unread: a big search can finish between polls.
        if (status !== 'running' && (page.nextCursor == null || !page.people.length)) {
          stop = status
          break
        }
        if (page.people.length < POLL_SIZE) await sleep(POLL_EVERY_MS)
      }
    } finally {
      // Still spending the host's proxy data for people nobody will read.
      if (status === 'running') await calls.cancel?.(started.id).catch(() => {})
    }
    if (fromWebsite.length && usable() < count) {
      await take(fromWebsite)
      if (usable() >= count) stop = 'full'
    }
    return true
  }

  if (!(await runRound())) return empty(['Verified people search is busy right now — try again in a moment.'])
  while (
    stop === 'done' &&
    usable() < count &&
    roundFound > 0 &&
    rounds < MAX_ROUNDS &&
    now() - startedAt < NO_NEW_ROUND_AFTER_MS &&
    opts.listening?.() &&
    funnel.nextRound()
  ) {
    if (!(await runRound())) stop = 'source failed'
  }

  const kept = funnel.finish(items, stop !== 'source failed')
  const shown = usable()
  const counts = { hits: found, shown, rounds, places, ...kept.counts, prospectCredits: shown, ...statCounts(stats) }
  console.log(`[Prospecting] Verified search ${JSON.stringify({ stop, ...counts })}`)
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
      page: input.cursor ? 'more' : resumedSearch ? 'resumed' : 'first',
    },
    counts,
    stop,
  })

  // A prospect credit for each person shown, as for any other search.
  const { recordUsage } = await import('../usage')
  recordUsage({ searches: 1, prospects: shown, prospectCredits: shown, searchShown: shown, searchHits: found, ...kept.usage })

  return {
    items,
    nextCursor: kept.nextCursor,
    reportedTotal: found,
    warnings: [],
    details: kept.details,
    requests: 1,
    refined: [],
    resumed: kept.resumed,
  }
}
