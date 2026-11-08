// Verified people search (Stage 2). When the host has it on
// (hostRules.ts hostVerifiedPeopleSearch), a people search is answered by the
// host's liscrape search over OpenSERP: it finds LinkedIn profiles by job title
// and confirms each against the live profile (title mask, location, employer
// industry/size) before returning them. It's slower than the index/web path —
// minutes, streamed — but every person is checked, so there's no off-title,
// enrichment or wrong-company. Each batch still goes through search.ts's funnel
// (verifiedFunnel) before it's shown, and more people are asked for than the
// page wants, since that leaves out about half of them or more. A country, or
// a search with none, also searches cities, a few at a time (searchPlaces.ts).
//
// A batch the time limit cuts short isn't cancelled: it goes on at the host
// for a few minutes more, and the next page of the same search (Load more, or
// the same search run again) takes who it found, stops it if it's still going,
// and searches its own cities (createCutShortBatches). It isn't read on: what's
// left of a batch by then is mostly the deeper pages of the same queries.
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
/**
 * How long a batch the time limit cut short goes on at the host after its page
 * is shown. Some are reading their last profiles and websites by then (6 of
 * hq's 21 verified searches, 2026-11), others have run half their searches
 * (one on the dev copy, 2026-11-06, whose rest found 2 people in 7 minutes).
 * The host runs two searches at a time for every workspace, so it isn't left longer.
 */
const FINISH_MS = 4 * 60_000
/** How long who it found is held for the next page, as searchPool.ts holds a search's unused hits. */
const HELD_MS = 60 * 60_000
/** Most cut-short batches held at once; the oldest go first. */
const MAX_HELD = 50
const BUSY = 'Verified people search is busy right now — try again in a moment.'

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

/** What the host did after `b`, from its running totals `a`. */
function subStats(a: HostStats | null, b: HostStats | null): HostStats | null {
  if (!a || !b) return a
  const rejected: Record<string, number> = {}
  for (const [why, n] of Object.entries(a.rejected ?? {})) if (n > (b.rejected?.[why] ?? 0)) rejected[why] = n - (b.rejected?.[why] ?? 0)
  return {
    searches: Math.max(0, a.searches - b.searches),
    engineErrors: Math.max(0, a.engineErrors - b.engineErrors),
    siteIgnored: Math.max(0, a.siteIgnored - b.siteIgnored),
    candidates: Math.max(0, a.candidates - b.candidates),
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

/** A batch the time limit cut short: it finishes at the host, and the next page of the same search takes who it found. */
interface CutShort {
  id: string
  /** Where reading it at the host carries on. */
  cursor: number
  /** Who it found after its page was shown, on no page yet: the host's minimised fields only. */
  rows: HostPerson[]
  /** The host's running totals: people found, and its counts. */
  found: number
  stats: HostStats | null
  /** The same totals when its page was shown: the next page counts only what came after. */
  base: { found: number; stats: HostStats | null }
  /** Still searching at the host: the next page reads who it has found since from `cursor`, then stops it. */
  running: boolean
  /** A page has it, or it was dropped: finishing stops, without cancelling. */
  taken: boolean
  at: number
  cancel: () => Promise<unknown>
}

/**
 * Cut-short batches, by the point of a search they're for (VerifiedFunnel.at):
 * in memory only, held for HELD_MS at most, capped, gone on restart.
 */
export function createCutShortBatches(now: () => number = Date.now) {
  const held = new Map<string, CutShort>()
  const drop = (key: string) => {
    const batch = held.get(key)
    held.delete(key)
    if (!batch || batch.taken) return
    batch.taken = true
    if (batch.running) void batch.cancel().catch(() => {})
  }
  return {
    /** Holds `batch` for whichever page starts at `key`, in place of any held there. */
    put(key: string, batch: CutShort) {
      for (const [k, b] of held) if (now() - b.at >= HELD_MS) drop(k)
      drop(key)
      held.set(key, batch)
      while (held.size > MAX_HELD) drop(held.keys().next().value!)
    },
    /** The batch held for a page starting at `key`, which that page now has; null if none. */
    take(key: string): CutShort | null {
      const batch = held.get(key)
      if (!batch) return null
      if (now() - batch.at >= HELD_MS) {
        drop(key)
        return null
      }
      held.delete(key)
      batch.taken = true
      return batch
    },
    /** For tests. */
    size: () => held.size,
  }
}

export type CutShortBatches = ReturnType<typeof createCutShortBatches>

const CUT_SHORT = createCutShortBatches()

/** Reads a cut-short batch on until it finishes at the host or FINISH_MS has passed, then cancels it if it's still going. */
async function finishBatch(batch: CutShort, calls: HostCalls, sleep: (ms: number) => Promise<void>, now: () => number) {
  const until = now() + FINISH_MS
  while (!batch.taken && batch.running && now() < until) {
    const page = await calls.poll(batch.id, batch.cursor).catch(() => null)
    // A page took it meanwhile, and reads these people itself from where this had got to.
    if (batch.taken) return
    if (!page) break
    batch.rows.push(...page.people.filter((row) => row?.profileUrl))
    batch.found = page.found
    batch.stats = page.stats ?? batch.stats
    if (page.nextCursor != null) batch.cursor = page.nextCursor
    if (page.status !== 'running' && (page.nextCursor == null || !page.people.length)) batch.running = false
    else if (page.people.length < POLL_SIZE) await sleep(POLL_EVERY_MS)
  }
  if (batch.taken || !batch.running) return
  batch.running = false
  await batch.cancel().catch(() => {})
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
  /**
   * Everyone the search kept, whether it ran, and whether it searched its own
   * cities (not where an earlier page's cut-short batch filled it, or the host
   * was busy after it): what the funnel did, for the log, usage and the page,
   * and where the next search takes up.
   */
  finish(items: PersonResult[], ran: boolean, citiesSearched?: boolean): { counts: Record<string, number>; usage: Parameters<typeof import('../usage').recordUsage>[0]; details: string[]; resumed: boolean; nextCursor: string | null }
  /**
   * Where this search starts (a page's cursor, or where the last one stopped),
   * and a key for any point of a search with these filters: a batch the time
   * limit cut short finishes for the page that starts where its own left off.
   * Without it, such a batch is cancelled.
   */
  at?: { start: string | null; key(cursor: string | null): string }
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
  /** Where cut-short batches are held (tests). */
  cutShort?: CutShortBatches
}

/**
 * Runs a verified people search to completion (or until `count` people worth
 * showing or the time cap), streaming each batch through `onPeople`, and
 * cancels it at the host if it's still going, unless the time cap cut it
 * short: that batch finishes for the next page. Where the page isn't full and
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
  const company = input.company ?? null
  const sizes = [...new Set((input.companySizes ?? []).flatMap((b) => BUCKET_TO_BANDS[b] ?? []))]
  const body = () => ({
    titles,
    locations: input.country?.trim() ? [input.country.trim()] : [],
    // Inside one company: the host names it in the query and keeps only those whose live
    // employer is it (by name or company page), so its industry, size and website don't apply.
    ...(company
      ? { industries: [], sizes: [], companies: [company.name], companySlugs: [company.ref] }
      : {
          industries: input.industries ?? [],
          sizes,
          ...(funnel.plan.places.length ? { places: funnel.plan.places, placesOnly: funnel.plan.placesOnly } : {}),
          // The host also reads company websites, where it runs that and the filter suits it.
          founderSites: true,
        }),
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
  let websiteFound = 0

  /** Makes `people` ready and adds them to the page, as far as there's room. */
  const take = async (people: PersonResult[]) => {
    const ready = people.length ? await funnel.prepare(people) : []
    // When there's less room than people, those whose email is likeliest to be found take it.
    const chosen = new Set(funnel.findableFirst(ready.filter((p) => !funnel.hidden(p))).slice(0, Math.max(0, count - usable())).map((p) => p.profileUrl))
    const taken = ready.filter((p) => funnel.hidden(p) || chosen.has(p.profileUrl))
    items.push(...taken)
    if (taken.length) opts.onPeople?.({ items: taken, refined: [] })
  }

  /** This page's last batch, where the time limit cut it short while the host was still searching. */
  // Set inside runRound, which control flow here can't see.
  let cutShort = null as Pick<CutShort, 'id' | 'cursor' | 'found' | 'stats'> | null
  /** People this page took from a batch an earlier page cut short. */
  let heldOver = 0

  /** One batch of cities, to the end of its host search, or who one an earlier page cut short has found, stopping it; false if it couldn't start. */
  const runRound = async (earlier?: CutShort): Promise<boolean> => {
    const started = earlier ? { id: earlier.id } : await calls.start(body()).catch(() => null)
    if (!started) return false
    if (!earlier) {
      rounds++
      places += funnel.plan.places.length
    }
    const roundStartedAt = now()
    const earlierFound = found
    const earlierStats = stats
    // An earlier page's batch: only what the host did after that page counts here.
    const base = earlier?.base ?? { found: 0, stats: null }
    let host = { found: earlier?.found ?? 0, stats: earlier?.stats ?? null }
    let cursor = earlier?.cursor ?? 0
    let status = !earlier || earlier.running ? 'running' : 'done'
    let outOfTime = false
    roundFound = 0
    // Wait for the end of the batch: they only take the room those with a live profile leave.
    const fromWebsite: PersonResult[] = []
    stop = 'time limit'
    /** Counts what the host has done so far, and sorts out who's new. */
    const read = (page: Pick<HostPage, 'found' | 'stats' | 'people'>): PersonResult[] => {
      host = { found: page.found, stats: page.stats ?? host.stats }
      roundFound = Math.max(0, host.found - base.found)
      found = earlierFound + roundFound
      stats = addStats(earlierStats, subStats(host.stats, base.stats))
      const fresh: PersonResult[] = []
      for (const row of page.people) {
        if (!row?.profileUrl || seen.has(row.profileUrl)) continue
        seen.add(row.profileUrl)
        const person = mapPerson(row, searchId)
        ;(person.fromWebsite ? fromWebsite : fresh).push(person)
        if (person.fromWebsite) websiteFound++
      }
      return fresh
    }
    try {
      if (earlier) {
        heldOver += earlier.rows.length
        await take(read({ found: earlier.found, stats: earlier.stats, people: earlier.rows }))
        // Who it has found since it was last read, if it's still going: then it's stopped, below.
        const since = usable() < count && earlier.running ? await calls.poll(started.id, cursor).catch(() => null) : null
        if (since) {
          status = since.status
          heldOver += since.people.length
          await take(read(since))
        }
        stop = usable() >= count ? 'full' : 'done'
      }
      while (stop === 'time limit' && usable() < count) {
        if (now() - roundStartedAt >= MAX_WAIT_MS) {
          outOfTime = true
          break
        }
        const page = await calls.poll(started.id, cursor).catch(() => null)
        if (!page) {
          stop = 'source failed'
          break
        }
        status = page.status
        if (page.nextCursor != null) cursor = page.nextCursor
        await take(read(page))
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
      // Still spending the host's proxy data for people nobody will read, unless
      // the time limit cut it short: then it finishes for the next page.
      if (status === 'running') {
        if (outOfTime) cutShort = { id: started.id, cursor, ...host }
        else await calls.cancel?.(started.id).catch(() => {})
      }
    }
    if (fromWebsite.length && usable() < count) {
      await take(fromWebsite)
      if (usable() >= count) stop = 'full'
    }
    return true
  }

  // What an earlier page of this search left finishing comes first, then this page's own cities.
  const held = deps.cutShort ?? CUT_SHORT
  const earlier = funnel.at ? held.take(funnel.at.key(funnel.at.start)) : null
  const warnings: string[] = []
  if (earlier) await runRound(earlier)
  if (usable() < count && !(await runRound())) {
    if (!earlier) return empty([BUSY])
    warnings.push(BUSY)
  }
  while (
    stop === 'done' &&
    rounds > 0 &&
    !warnings.length &&
    usable() < count &&
    roundFound > 0 &&
    rounds < MAX_ROUNDS &&
    now() - startedAt < NO_NEW_ROUND_AFTER_MS &&
    opts.listening?.() &&
    funnel.nextRound()
  ) {
    if (!(await runRound())) stop = 'source failed'
  }

  const kept = funnel.finish(items, stop !== 'source failed', rounds > 0)
  if (cutShort) {
    const { id } = cutShort
    const cancel = async () => calls.cancel?.(id)
    if (funnel.at) {
      const batch: CutShort = { ...cutShort, rows: [], base: { found: cutShort.found, stats: cutShort.stats }, running: true, taken: false, at: now(), cancel }
      held.put(funnel.at.key(kept.nextCursor), batch)
      void finishBatch(batch, calls, sleep, now).catch(() => {})
    } else await cancel().catch(() => {})
  }
  const shown = usable()
  const onWebsites = items.filter((p) => p.fromWebsite)
  const websiteCounts: Record<string, number> = websiteFound ? { websiteFound, websiteShown: onWebsites.filter((p) => !funnel.hidden(p)).length, websiteHidden: onWebsites.filter(funnel.hidden).length } : {}
  const carried: Record<string, number> = { ...(heldOver ? { heldOver } : {}), ...(cutShort && funnel.at ? { leftFinishing: 1 } : {}) }
  const counts = { hits: found, shown, rounds, places, ...kept.counts, prospectCredits: shown, ...websiteCounts, ...carried, ...statCounts(stats) }
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
      company: company?.ref ?? null,
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
    warnings,
    details: kept.details,
    requests: 1,
    refined: [],
    resumed: kept.resumed,
  }
}
