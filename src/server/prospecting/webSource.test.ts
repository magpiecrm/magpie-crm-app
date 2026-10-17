import { describe, expect, it, vi } from 'vitest'
import { createWebSource, queryPlan } from './webSource'
import { WebSearchUnavailable, type WebResult, type WebSearch, type WebSearchOptions } from './webSearch'
import type { PeopleSource, PersonResult } from './types'

// Made-up people, in the shapes Google's results for LinkedIn profiles take (linkedinResults.ts).
const fast = { hedgeMs: 5, pausesMs: [0, 1, 1] }
const lookups: PeopleSource = { searchPeople: vi.fn(), getPerson: vi.fn(async () => null) }

/** A surname for the k-th person: names are letters only. */
const surname = (k: number) => `Person${String.fromCharCode(97 + Math.floor(k / 26))}${String.fromCharCode(97 + (k % 26))}`

/** A page of `n` results: founders at made-up companies, all in the United Kingdom unless said. */
function page(query: string, n: number, opts: { at?: number; country?: string; title?: string } = {}): WebResult[] {
  return Array.from({ length: n }, (_, i) => {
    const k = (opts.at ?? 0) + i
    return {
      url: `https://uk.linkedin.com/in/person-${k}-${query.length}`,
      title: `Pat ${surname(k)} - ${opts.title ?? 'Founder'} at Company ${k} | LinkedIn`,
      description: '',
      info: [`Leeds, England, ${opts.country ?? 'United Kingdom'}`, opts.title ?? 'Founder', `Company ${k}`],
    }
  })
}

/** A web search answering from `answer`, recording what it was asked. */
function fakeSearch(answer: (query: string, opts: WebSearchOptions) => WebResult[] | Error) {
  const calls: Array<{ query: string; opts: WebSearchOptions }> = []
  const search: WebSearch = async (query, _country, opts = {}) => {
    calls.push({ query, opts })
    const a = answer(query, opts)
    if (a instanceof Error) throw a
    return a
  }
  return { search, calls }
}

describe('queryPlan', () => {
  it('ORs the titles, then each alone, then the past year, then the country’s own site', () => {
    const plan = queryPlan({ titles: ['Founder', 'CEO'], country: 'United Kingdom' }, null)
    expect(plan).toEqual([
      { query: 'site:linkedin.com/in ("Founder" OR "CEO")', maxPage: 10 },
      { query: 'site:linkedin.com/in "Founder"', maxPage: 5 },
      { query: 'site:linkedin.com/in "CEO"', maxPage: 5 },
      { query: 'site:linkedin.com/in ("Founder" OR "CEO")', maxPage: 5, recent: true },
      { query: 'site:uk.linkedin.com/in ("Founder" OR "CEO")', maxPage: 5 },
    ])
  })

  it('searches a department’s leaders by the ways their titles are written', () => {
    const [sales, revenue] = queryPlan({ titles: ['Sales leaders'] }, null)
    expect(sales.query).toContain('"Head of Sales"')
    expect(sales.query).toContain('"VP Sales"')
    // Revenue leaders are sales leaders too (socialfetch.ts ALSO_LEADS), in the next query when they don't fit in one.
    expect(`${sales.query} ${revenue.query}`).toContain('"Chief Revenue Officer"')
    expect(sales.query).not.toContain('Sales leaders')
  })

  it('names the company searched, and a few of the companies found first to a query', () => {
    expect(queryPlan({ titles: ['Founder'] }, { ref: '1', name: 'Larkspur Labs' })[0].query).toBe('site:linkedin.com/in "Founder" "Larkspur Labs"')
    const names = Object.fromEntries(['Aster', 'Birch', 'Cedar', 'Daisy', 'Elm Co'].map((n, i) => [String(i), n]))
    const plan = queryPlan({ titles: ['Founder'], companyRefs: Object.keys(names), companyNames: names }, null)
    expect(plan.map((s) => s.query)).toEqual([
      'site:linkedin.com/in "Founder" ("Aster" OR "Birch" OR "Cedar" OR "Daisy")',
      'site:linkedin.com/in "Founder" "Elm Co"',
    ])
  })

  it('has nothing to search without a title, company or keyword', () => {
    expect(queryPlan({}, null)).toEqual([])
  })
})

describe('searchPeople', () => {
  it('reads people from the results, with their title, employer and country', async () => {
    const { search } = fakeSearch((q) => page(q, 10))
    const result = await createWebSource(search, lookups, fast).searchPeople(null, { titles: ['Founder'], country: 'United Kingdom', count: 5 })
    expect(result.items).toHaveLength(5)
    expect(result.items[0]).toMatchObject<Partial<PersonResult>>({ firstName: 'Pat', lastName: surname(0), title: 'Founder', company: 'Company 0', country: 'United Kingdom', source: 'web', companyRef: null })
    expect(result.requests).toBe(1)
    expect(result.funnel).toMatchObject({ webPages: 1, webTries: 1, webPaid: 1 })
  })

  it('holds the rest of a page for the next, and carries on there', async () => {
    const { search, calls } = fakeSearch((q, o) => page(q, 10, { at: ((o.page ?? 1) - 1) * 10 }))
    const source = createWebSource(search, lookups, fast)
    const first = await source.searchPeople(null, { titles: ['Founder'], count: 4 })
    expect(calls).toHaveLength(1)
    const second = await source.searchPeople(null, { titles: ['Founder'], count: 4, cursor: first.nextCursor! })
    // From the held page: nothing fetched, nothing counted.
    expect(calls).toHaveLength(1)
    expect(second.requests).toBe(0)
    expect(second.items.map((p) => p.lastName)).toEqual([4, 5, 6, 7].map(surname))
    const third = await source.searchPeople(null, { titles: ['Founder'], count: 4, cursor: second.nextCursor! })
    expect(third.items.map((p) => p.lastName)).toEqual([8, 9, 10, 11].map(surname))
    expect(calls.at(-1)?.opts.page).toBe(2)
  })

  it('leaves out people without the title, or in another country', async () => {
    // Only the first query's first page has anyone.
    const { search } = fakeSearch((q, o) => ((o.page ?? 1) > 1 || o.recent || q !== 'site:linkedin.com/in "Founder"' ? [] : [...page(q, 3), ...page(q, 2, { at: 10, title: 'Accountant' }), ...page(q, 2, { at: 20, country: 'Germany' })]))
    const result = await createWebSource(search, lookups, fast).searchPeople(null, { titles: ['Founder'], country: 'United Kingdom', count: 25 })
    expect(result.items).toHaveLength(3)
    expect(result.funnel).toMatchObject({ offTitle: 2, filteredOut: 2 })
  })

  it('moves to the next query when one runs out', async () => {
    const { search, calls } = fakeSearch((q) => (q.includes(' OR ') ? page(q, 3) : page(q, 10, { at: 50 })))
    const result = await createWebSource(search, lookups, fast).searchPeople(null, { titles: ['Founder', 'CEO'], count: 8 })
    expect(calls[0].query).toContain(' OR ')
    expect(calls.some((c) => c.query === 'site:linkedin.com/in "Founder"')).toBe(true)
    expect(result.items.length).toBeGreaterThan(3)
  })

  it('asks again for a page the provider couldn’t get', async () => {
    let tries = 0
    const { search } = fakeSearch((q) => (++tries < 3 ? new WebSearchUnavailable() : page(q, 10)))
    const result = await createWebSource(search, lookups, fast).searchPeople(null, { titles: ['Founder'], count: 5 })
    expect(result.items).toHaveLength(5)
    expect(result.funnel?.webTries).toBe(3)
    expect(result.funnel?.webPaid).toBe(1)
  })

  it('fails when no page comes back at all, and doesn’t retry a refused key', async () => {
    const down = fakeSearch(() => new WebSearchUnavailable())
    await expect(createWebSource(down.search, lookups, fast).searchPeople(null, { titles: ['Founder'], count: 5 })).rejects.toBeInstanceOf(WebSearchUnavailable)
    expect(down.calls).toHaveLength(6)
    const refused = fakeSearch(() => new Error('Web search answered 401'))
    await expect(createWebSource(refused.search, lookups, fast).searchPeople(null, { titles: ['Founder'], count: 5 })).rejects.toThrow('401')
    expect(refused.calls).toHaveLength(2)
  })

  it('keeps only people at the company searched, where the result names their employer', async () => {
    const { search } = fakeSearch(() => [
      ...page('', 1, { at: 1 }).map((r) => ({ ...r, info: ['Leeds, England, United Kingdom', 'Founder', 'Larkspur Labs Ltd'] })),
      ...page('', 2, { at: 5 }),
    ])
    const result = await createWebSource(search, lookups, fast).searchPeople({ ref: '42', name: 'Larkspur Labs' }, { titles: ['Founder'] })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ company: 'Larkspur Labs', companyRef: '42' })
  })

  it('asks for the batches of companies found first all at once, not in turn', async () => {
    let inFlight = 0
    let most = 0
    const search: WebSearch = async (query) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return page(query, 2)
    }
    const names = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i), `Firm ${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}`]))
    // No second copies here (hedgeMs), so what's in flight at once is pages.
    const result = await createWebSource(search, lookups, { hedgeMs: 1_000, pausesMs: [0] }).searchPeople(null, { titles: ['Founder'], companyRefs: Object.keys(names), companyNames: names, count: 25 })
    expect(most).toBe(5)
    expect(result.funnel?.webPages).toBe(5)
  })

  it('hands profile lookups to the other source', async () => {
    const { search } = fakeSearch(() => [])
    await createWebSource(search, lookups, fast).getPerson('https://www.linkedin.com/in/someone')
    expect(lookups.getPerson).toHaveBeenCalledWith('https://www.linkedin.com/in/someone')
  })
})
