// People search from a search engine's index of public LinkedIn profiles
// (Google, through webSearch.ts), in place of SocialFetch's people search.
// Profile and company lookups, and company search, are another source's
// (`lookups`): in a hosted copy, its host, which reads LinkedIn's public
// pages.
//
// A search becomes a plan of queries (queryPlan): the job titles ORed
// together, then each title on its own, then results from the past year,
// then the country's own LinkedIn site, each paged until Google runs out. A
// page that doesn't come back is asked for again, a second copy after a few
// seconds and later rounds after a pause: Decodo gives up on a share of
// Google searches (status 613), more at some hours than others, and isn't
// paid for those (checked 2026-10-17). Pages fetched beyond what a page of
// results used are held (searchPool.ts) for the next.
//
// Results carry the name, the job title and usually the employer and
// country (linkedinResults.ts), so unlike SocialFetch's hits most people
// don't need a profile lookup to say where they work. Nothing is fetched
// from LinkedIn here, and a query never names a person.

import { canonicalCountry } from './geo'
import { classifySeniority } from './seniority'
import { createSearchPool, isOffTitle, searchPoolKey, type HeldHits, type Hit } from './searchPool'
import { companyKey, sameCompanyName, searchesForTitles, titleQueries, type TitleQuery } from './socialfetch'
import { anyOf, countrySite, phrase, profileSite, readListing } from './linkedinResults'
import { MAX_PAGE, WebSearchUnavailable, type WebResult, type WebSearch } from './webSearch'
import type { CompanyFilters, CompanyRef, CompanyResult, CompanySource, Page, PeopleFilters, PeopleSource, PersonResult } from './types'

const SOURCE = 'web' as const
const MAX_TITLES = 5
/** Phrases ORed in one query: Google reads the first 32 words of a query. */
const TERMS_PER_QUERY = 8
/** Company names ORed in one query, beside the titles. */
const NAMES_PER_QUERY = 4
/**
 * Companies a companies-first batch takes (search.ts): SocialFetch's search
 * takes 20, but here a batch is queries of NAMES_PER_QUERY, so a bigger one
 * covers more companies in the same rounds of pages.
 */
const COMPANIES_PER_SEARCH = 40
/** Most Google pages one call fetches, and how many at once: a batch of 40 companies is 10 queries, two pages deep at most. */
const MAX_PAGES_PER_CALL = 20
const PAGES_AT_ONCE = 20
/** People with a title searched a page usually brings: how many pages are fetched at once for what's still needed. */
const PEOPLE_PER_PAGE = 7
/** A page with fewer profiles than this is the last its query has. */
const PROFILES_FOR_MORE = 5
/**
 * Each page is asked for twice at once, and if both fail, again, three rounds
 * in all. An answer takes 2-4 seconds and a failure about 10 (Decodo's own
 * retries), and failures aren't paid for, so asking twice costs a little more
 * (when both answer) and saves the 10 seconds a failure would cost: on hq
 * (2026-10-17) a second copy only after 4 seconds, and pauses between rounds,
 * made a page of people take 86 seconds of searching.
 */
const HEDGE_MS = 0
const ROUND_PAUSES_MS = [0, 500, 1_500]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A failure worth asking again: the provider couldn't get the page, a timeout, the network, or a server error. Not a refused key or a rate limit. */
const retryable = (err: unknown) =>
  err instanceof WebSearchUnavailable || err instanceof TypeError || ['TimeoutError', 'AbortError'].includes((err as any)?.name) || /answered 5\d\d/.test(String((err as any)?.message))
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** One query of a search's plan, and how deep it's paged. */
export interface Step {
  query: string
  maxPage: number
  recent?: boolean
}

/** The phrases a title query is searched by: the title, or for a department's leaders the ways their titles are written. */
export function termsFor(q: TitleQuery): string[] {
  if (!q.leaders.length) return q.search ? [q.search] : []
  const d = q.search
  const asked = q.leaders.filter((t) => !/\b(leaders?|leadership)$/i.test(t))
  const out: string[] = []
  for (const t of [...asked, `Head of ${d}`, `VP ${d}`, `Chief ${d} Officer`, `${d} Director`, `Director of ${d}`]) if (!out.some((o) => norm(o) === norm(t))) out.push(t)
  return out
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** The queries a search runs, in order: what the cursor walks through. Empty when there's nothing to search by. */
export function queryPlan(filters: PeopleFilters, company: CompanyRef | null): Step[] {
  const titles = [...new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TITLES)
  const terms: string[] = []
  for (const t of titleQueries(titles, { small: filters.smallCompanies }).flatMap(termsFor)) if (!terms.some((o) => norm(o) === norm(t))) terms.push(t)
  const keyword = filters.keyword?.trim() ? ` ${filters.keyword.trim().replace(/["“”]/g, '')}` : ''
  const who = (c: string[]) => (c.length ? ` ${anyOf(c)}` : '')
  const groups = terms.length ? chunks(terms, TERMS_PER_QUERY) : [[]]
  // Companies found first (search.ts): their names, a few to a query beside the titles.
  const names = (filters.companyRefs ?? []).map((ref) => filters.companyNames?.[ref]).filter((n): n is string => Boolean(n && companyKey(n).length >= 3))
  if (names.length) return chunks(names, NAMES_PER_QUERY).map((batch) => ({ query: `${profileSite()}${who(terms.slice(0, 6))} ${anyOf(batch)}${keyword}`, maxPage: 2 }))
  const at = company ? ` ${phrase(company.name)}` : ''
  if (!terms.length && !at && !keyword) return []
  const steps: Step[] = groups.map((g) => ({ query: `${profileSite()}${who(g)}${at}${keyword}`, maxPage: company ? 5 : MAX_PAGE }))
  if (terms.length > 1) for (const t of terms) steps.push({ query: `${profileSite()} ${phrase(t)}${at}${keyword}`, maxPage: company ? 2 : 5 })
  if (!company) {
    for (const g of groups) steps.push({ query: `${profileSite()}${who(g)}${keyword}`, maxPage: 5, recent: true })
    const sub = countrySite(filters.country)
    if (sub) for (const g of groups) steps.push({ query: `${profileSite(sub)}${who(g)}${keyword}`, maxPage: 5 })
  }
  return steps
}

/** Where a search carries on: a step of its plan, a page of it, and how many of that page's hits were used. */
interface Position {
  step: number
  page: number
  offset: number
}

function shortHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const CURSOR_PREFIX = 'web:'
function encodeCursor(plan: string, at: Position): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify({ h: plan, s: at.step, p: at.page, o: at.offset })).toString('base64url')}`
}
function decodeCursor(cursor: string | undefined, plan: string): Position {
  if (!cursor?.startsWith(CURSOR_PREFIX)) return { step: 0, page: 1, offset: 0 }
  try {
    const c = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString())
    // A cursor from a different plan (the filters changed) starts again at the top.
    if (c?.h !== plan || ![c.s, c.p, c.o].every((n) => Number.isInteger(n) && n >= 0)) return { step: 0, page: 1, offset: 0 }
    return { step: c.s, page: Math.max(1, c.p), offset: c.o }
  } catch {
    return { step: 0, page: 1, offset: 0 }
  }
}

const people_ = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

export function createWebSource(
  search: WebSearch,
  lookups: PeopleSource & Partial<CompanySource>,
  /** For tests: the retry timings. */
  timing: { hedgeMs?: number; pausesMs?: number[] } = {},
): PeopleSource & CompanySource {
  const pool = createSearchPool()
  const hedgeMs = timing.hedgeMs ?? HEDGE_MS
  const pauses = timing.pausesMs ?? ROUND_PAUSES_MS

  /**
   * One Google page, asked for until it comes back (HEDGE_MS, ROUND_PAUSES_MS),
   * or null when every try failed. `tally` counts the tries and the answers
   * paid for.
   */
  async function fetchPage(step: Step, page: number, country: string | null, tally: { attempts: number; paid: number; lastError?: unknown }): Promise<WebResult[] | null> {
    const ask = () => {
      tally.attempts++
      return search(step.query, country, { page, exact: true, all: true, ...(step.recent ? { recent: 'year' as const } : {}) }).then(
        (results) => {
          tally.paid++
          return results
        },
        (err) => {
          tally.lastError = err
          return null
        },
      )
    }
    for (const pause of pauses) {
      if (pause) await sleep(pause)
      const answer = await new Promise<WebResult[] | null>((resolve) => {
        let pending = 2
        let second = false
        let done = false
        const settle = (r: WebResult[] | null) => {
          if (done) return
          if (r) {
            done = true
            clearTimeout(timer)
            return resolve(r)
          }
          if (--pending === 0) {
            done = true
            resolve(null)
          } else start2()
        }
        // The second copy: when the first is slow, or as soon as it fails.
        const start2 = () => {
          if (second || done) return
          second = true
          clearTimeout(timer)
          ask().then(settle)
        }
        const timer = setTimeout(start2, hedgeMs)
        ask().then(settle)
      })
      if (answer) return answer
      if (!retryable(tally.lastError)) return null
    }
    return null
  }

  return {
    companiesPerSearch: COMPANIES_PER_SEARCH,

    searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>> {
      if (!lookups.searchCompanies) throw new Error('Company search is not available.')
      return lookups.searchCompanies(filters)
    },

    getCompany(ref: string, slug?: string | null, opts?: { pageOnly?: boolean }): Promise<CompanyResult | null> {
      if (!lookups.getCompany) return Promise.resolve(null)
      return lookups.getCompany(ref, slug, opts)
    },

    getPerson(profileRef: string): Promise<PersonResult | null> {
      return lookups.getPerson(profileRef)
    },

    async searchPeople(company: CompanyRef | null, filters: PeopleFilters): Promise<Page<PersonResult>> {
      const titles = [...new Set((filters.titles ?? []).map((t) => t.trim()).filter(Boolean))]
      const warnings: string[] = []
      const details: string[] = []
      if (titles.length > MAX_TITLES) warnings.push(`Only the first ${MAX_TITLES} job titles were searched.`)
      const queries = titleQueries(titles.slice(0, MAX_TITLES), { small: filters.smallCompanies })
      const plan = queryPlan(filters, company)
      if (!plan.length) {
        warnings.push('Add a job title, a company or a keyword to search by.')
        return { items: [], nextCursor: null, reportedTotal: null, warnings, details, requests: 0 }
      }
      const planKey = shortHash(JSON.stringify([plan, filters.country ?? null]))
      const wantedCountry = canonicalCountry(filters.country)
      const country = wantedCountry ?? null
      if (!filters.cursor && filters.industries?.length) details.push("Search results don't say which industry anyone's employer is in, so industry isn't filtered here.")

      // Every hit is read against all the titles searched, as in socialfetch.ts.
      const anyRoles = queries.some((q) => q.roles) ? (text: string) => [...new Set(queries.flatMap((q) => q.roles?.(text) ?? []))] : null
      const isTitle = (text: string) => Boolean(anyRoles?.(text).length) || classifySeniority(text) !== null
      const readPage = (results: WebResult[]): { hits: Hit[]; profiles: number } => {
        const hits: Hit[] = []
        for (const r of results) {
          const listed = readListing(r, isTitle)
          if (!listed) continue
          const roles = anyRoles ? [...new Set(listed.jobTexts.flatMap((t) => anyRoles(t)))] : null
          if (roles && !roles.length) {
            hits.push({ offTitle: listed.profileUrl })
            continue
          }
          const title = roles?.length ? roles.join(', ') : listed.title
          hits.push({
            profileUrl: listed.profileUrl,
            firstName: listed.firstName,
            lastName: listed.lastName,
            title,
            seniority: classifySeniority(title),
            company: listed.company,
            companyRef: null,
            companyDomain: null,
            country: listed.country,
            source: SOURCE,
          })
        }
        return { hits, profiles: hits.length }
      }

      // People with a title searched this call should bring, across its title queries, as socialfetch.ts would.
      const perTitle = Math.min(50, Math.max(1, Math.round(filters.count ?? 25)))
      const want = Math.min(50, perTitle * Math.max(1, queries.length))
      const poolKey = (at: Position) => searchPoolKey({ plan: planKey }, at.step * 10_000 + at.page * 100 + at.offset)

      const at = decodeCursor(filters.cursor, planKey)
      const tally = { attempts: 0, paid: 0, lastError: undefined as unknown }
      let pages = 0
      let emptyPages = 0
      let failedPage = false
      const used: Hit[] = []
      const onTitle = () => used.filter((h) => h && !isOffTitle(h)).length
      const after = (pos: Position, more: boolean): Position | null => {
        if (more && pos.page < plan[pos.step].maxPage) return { step: pos.step, page: pos.page + 1, offset: 0 }
        return pos.step + 1 < plan.length ? { step: pos.step + 1, page: 1, offset: 0 } : null
      }

      const hold = (pos: Position, hits: Hit[], more: boolean) => pool.put(poolKey(pos), { items: hits, hasMore: more, end: 0, reportedTotal: null, at: Date.now() })
      let next: Position | null = at.step < plan.length ? at : null
      while (next && onTitle() < want && !failedPage) {
        // The next pages in the plan, taken at once: those held from before as they are, and the rest
        // fetched together. More of this query while it's a deep one, and the first page of each query
        // after it, so a companies-first search's batches of names (two pages deep at most) are asked
        // for together rather than in turn; a shallow query's second page once its first, held, shows
        // there's more, so a batch's second pages come in one round too. Held pages were fetched again
        // before (0.9.99 and earlier): on hq a batch of 14 queries took 33 pages.
        const from: Position = next
        const shallow = plan[from.step].maxPage <= 2
        const span = Math.min(PAGES_AT_ONCE, MAX_PAGES_PER_CALL - pages)
        const walk: { pos: Position; held: HeldHits | null }[] = []
        let toFetch = 0
        // People on the title the held pages walked so far bring: no page is fetched for what they cover.
        let heldOnTitle = 0
        for (let p: Position | null = from; p; ) {
          const held: HeldHits | null = pool.take(poolKey(p))
          if (!held) {
            const stillWanted = want - onTitle() - heldOnTitle
            if (toFetch >= span || stillWanted <= 0 || (!shallow && toFetch >= Math.ceil(stillWanted / PEOPLE_PER_PAGE))) break
          }
          walk.push({ pos: p, held })
          if (held) heldOnTitle += held.items.filter((h) => h && !isOffTitle(h)).length
          else toFetch++
          const step: Step = plan[p.step]
          const deeper: boolean = p.page < step.maxPage && (step.maxPage > 2 || Boolean(held?.hasMore))
          p = deeper ? { step: p.step, page: p.page + 1, offset: 0 } : p.step + 1 < plan.length ? { step: p.step + 1, page: 1, offset: 0 } : null
        }
        if (!walk.length) break
        const fetched = await Promise.all(walk.map((w) => (w.held ? null : fetchPage(plan[w.pos.step], w.pos.page, country, tally))))
        const entries: { pos: Position; hits: Hit[] | null; more: boolean }[] = walk.map((w, i) => {
          if (w.held) return { pos: w.pos, hits: w.held.items, more: w.held.hasMore }
          const results = fetched[i]
          if (!results) return { pos: w.pos, hits: null, more: false }
          pages++
          const { hits, profiles } = readPage(results)
          if (!profiles) emptyPages++
          // Carrying on part-way through a page whose held hits were lost: the hits already used are passed over.
          return { pos: w.pos, hits: i === 0 && from.offset ? hits.slice(from.offset) : hits, more: profiles >= PROFILES_FOR_MORE }
        })
        // Hits are taken in plan order until there are enough. Where that stops (enough people, a page that
        // failed), the search carries on next time; pages fetched beyond that point are held for then, and
        // those of a query that ran out before them are dropped.
        const ahead = (pos: Position) => next !== null && (pos.step > next.step || (pos.step === next.step && pos.page > next.page))
        let stopped = false
        for (const e of entries) {
          const due = !stopped && next !== null && e.pos.step === next.step && e.pos.page === next.page
          if (!due) {
            if (e.hits?.length && ahead(e.pos)) hold(e.pos, e.hits, e.more)
            continue
          }
          if (!e.hits) {
            failedPage = true
            next = e.pos
            stopped = true
            continue
          }
          let walked = 0
          while (walked < e.hits.length && onTitle() < want) used.push(e.hits[walked++])
          if (walked < e.hits.length) {
            next = { ...e.pos, offset: e.pos.offset + walked }
            hold(next, e.hits.slice(walked), e.more)
            stopped = true
            continue
          }
          next = after(e.pos, e.more)
        }
      }
      if (!pages && !used.length && failedPage) {
        throw tally.lastError instanceof WebSearchUnavailable || !tally.lastError ? new WebSearchUnavailable("The search engine didn't return results just now. Try again in a minute.") : tally.lastError
      }
      if (failedPage) details.push("Some pages of search results didn't come back and will be asked for again on the next page.")

      // Read the hits taken: the title, the company searched, the country and seniority asked for.
      const named = Object.entries(filters.companyNames ?? {})
        .map(([ref, name]) => ({ ref, name, key: companyKey(name) }))
        .filter((c) => c.key.length >= 3)
        .sort((a, b) => b.key.length - a.key.length)
      const seen = new Set<string>()
      const people: PersonResult[] = []
      let offTitle = 0
      let wrongCompany = 0
      let wrongCountry = 0
      const offTitlePeople = new Set<string>()
      for (const hit of used) {
        if (!hit) continue
        if (isOffTitle(hit)) {
          offTitle++
          offTitlePeople.add(hit.offTitle)
          continue
        }
        if (seen.has(hit.profileUrl)) continue
        seen.add(hit.profileUrl)
        const person: PersonResult = { ...hit }
        if (company) {
          if (person.company && sameCompanyName(person.company, company.name)) {
            person.company = company.name
            person.companyRef = company.ref
          } else if (person.company) {
            // Google matched the name somewhere else on their profile (a past job, say).
            wrongCompany++
            continue
          }
        } else if (named.length && person.company) {
          const match = named.find((c) => sameCompanyName(person.company, c.name))
          if (match) {
            person.company = match.name
            person.companyRef = match.ref
          }
        }
        if (wantedCountry) {
          const c = canonicalCountry(person.country)
          if (c && c !== wantedCountry) {
            wrongCountry++
            continue
          }
          if (!c) person.country = wantedCountry
        }
        people.push(person)
      }
      const filtered = people.filter((p) => !filters.seniorities?.length || (p.seniority !== null && filters.seniorities.includes(p.seniority)))
      const hidden = people.length - filtered.length + wrongCountry
      for (const url of seen) offTitlePeople.delete(url)
      if (offTitle) details.push(`${people_(offTitle)} found by the search ${offTitle === 1 ? "doesn't" : "don't"} have the job title searched for and ${offTitle === 1 ? 'was' : 'were'} left out.`)
      if (wrongCompany) details.push(`${people_(wrongCompany)} found by the search ${wrongCompany === 1 ? "doesn't" : "don't"} currently work at ${company?.name} and ${wrongCompany === 1 ? 'was' : 'were'} hidden.`)
      if (hidden) details.push(`${people_(hidden)} didn't match your seniority or country filters and ${hidden === 1 ? 'is' : 'are'} hidden.`)
      console.log(`[WebSource] ${pages} result pages (${tally.attempts} tries, ${tally.paid} paid), ${used.length} profiles, ${filtered.length} kept${failedPage ? ', a page failed' : ''}`)

      return {
        items: filtered,
        nextCursor: next ? encodeCursor(planKey, next) : null,
        reportedTotal: null,
        warnings,
        details,
        // A call stands for one search per title query, as a SocialFetch request does, so a page's limits
        // (search.ts) work the same; what it fetched is in the funnel. Held hits cost nothing.
        requests: pages ? searchesForTitles(titles, { small: filters.smallCompanies }) : 0,
        funnel: {
          hits: used.length,
          offTitle,
          filteredOut: hidden,
          uniqueHits: seen.size + offTitlePeople.size,
          uniqueOffTitle: offTitlePeople.size,
          emptyRequests: emptyPages,
          onTitle: seen.size,
          webPages: pages,
          webTries: tally.attempts,
          webPaid: tally.paid,
        },
      }
    },
  }
}
