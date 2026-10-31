import { describe, expect, it, vi } from 'vitest'
import { verifiedPeopleSearch, type VerifiedFunnel } from './verifiedPeopleSource'
import { logSearch } from './searchLog'
import { recordUsage } from '../usage'
import type { PersonResult } from './types'

// The verified people search, with the host transport, allowance, usage and
// search log stubbed — so the test is just the mapping and the poll/stream loop.
vi.mock('./searchLog', () => ({ newSearchId: () => 'sid', logSearch: vi.fn() }))
vi.mock('../allowance', () => ({ remaining: () => 999, requireAllowance: vi.fn(() => { throw new Error('allowance') }) }))
vi.mock('../usage', () => ({ recordUsage: vi.fn() }))

const person = (over: Record<string, unknown> = {}) => ({
  profileUrl: 'https://uk.linkedin.com/in/jane-doe',
  name: 'Jane Doe',
  title: 'Sales Manager',
  titleVerified: true,
  country: 'GB',
  company: { name: 'Larkspur', slug: 'larkspur', url: 'https://www.linkedin.com/company/larkspur', industry: 'Software Development', sizeBand: '51-200', employees: 120, website: 'https://www.larkspur.example/about' },
  ...over,
})

/** A host transport that yields `pages` of poll responses in order, then 'done'. */
function calls(pages: Array<{ found: number; nextCursor: number | null; people: any[] }>) {
  let i = 0
  return {
    start: async () => ({ id: 's1' }),
    poll: async () => {
      const p = pages[i] ?? { found: pages.at(-1)?.found ?? 0, nextCursor: null, people: [] }
      i++
      return { status: i >= pages.length ? 'done' : 'running', found: p.found, nextCursor: p.nextCursor, people: p.people }
    },
  }
}

const deps = (c: ReturnType<typeof calls>) => ({ calls: c, sleep: async () => {}, now: () => 1_000 })

describe('verifiedPeopleSearch', () => {
  it('maps verified people to PersonResult and streams each batch', async () => {
    const onPeople = vi.fn()
    const page = await verifiedPeopleSearch({ titles: ['Sales Manager'], country: 'United Kingdom' }, { onPeople }, deps(calls([{ found: 2, nextCursor: 2, people: [person(), person({ profileUrl: 'https://www.linkedin.com/in/no-co', name: 'Sam Lee', title: 'Account Executive', titleVerified: false, country: null, company: null })] }])))
    expect(page.reportedTotal).toBe(2)
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({
      profileUrl: 'https://uk.linkedin.com/in/jane-doe',
      firstName: 'Jane',
      lastName: 'Doe',
      title: 'Sales Manager',
      company: 'Larkspur',
      companyRef: 'larkspur',
      companySlug: 'larkspur',
      companyDomain: 'larkspur.example',
      country: 'GB',
      source: 'web',
      titleExact: true,
      profileChecked: true,
      companySize: '51-200',
      searchId: 'sid',
    })
    // No company -> marked noCompany, no size.
    expect(page.items[1]).toMatchObject({ firstName: 'Sam', company: '', noCompany: true, titleExact: false })
    expect(onPeople).toHaveBeenCalledTimes(1)
    expect(onPeople.mock.calls[0][0].items).toHaveLength(2)
  })

  it('stops at the requested count and de-dupes across polls', async () => {
    const dup = person()
    const c = calls([
      { found: 5, nextCursor: 1, people: [dup, person({ profileUrl: 'https://x/in/a', name: 'A B' })] },
      { found: 5, nextCursor: 2, people: [dup, person({ profileUrl: 'https://x/in/c', name: 'C D' })] },
    ])
    const page = await verifiedPeopleSearch({ titles: ['Sales Manager'], count: 3 }, {}, deps(c))
    // dup counted once; a, c added -> 3 distinct, capped at count 3
    expect(page.items.map((p) => p.profileUrl)).toEqual(['https://uk.linkedin.com/in/jane-doe', 'https://x/in/a', 'https://x/in/c'])
  })

  it('returns empty with no titles, and a warning when the host can’t start', async () => {
    expect((await verifiedPeopleSearch({ titles: [] }, {}, deps(calls([])))).items).toEqual([])
    const noStart = { start: async () => null, poll: async () => null }
    const page = await verifiedPeopleSearch({ titles: ['Sales Manager'] }, {}, { calls: noStart as any, sleep: async () => {}, now: () => 0 })
    expect(page.items).toEqual([])
    expect(page.warnings[0]).toMatch(/busy/i)
  })

  it('builds the host body from the filters (sizes mapped to liscrape bands)', async () => {
    let sent: any = null
    const c = { start: async (b: unknown) => { sent = b; return { id: 's1' } }, poll: async () => ({ status: 'done', found: 0, nextCursor: null, people: [] }) }
    await verifiedPeopleSearch({ titles: ['Sales Manager'], industries: ['Financial Services'], companySizes: ['1-10', '51-200'], country: 'GB', count: 10 }, {}, { calls: c as any, sleep: async () => {}, now: () => 0 })
    expect(sent).toEqual({ titles: ['Sales Manager'], locations: ['GB'], industries: ['Financial Services'], sizes: ['1', '2-10', '51-200'], limit: 40 })
  })

  describe('with the funnel', () => {
    /** Leaves out `gone`, and marks people at `dead` as catch-all (hidden, as the page hides them). */
    const funnel = (over: { gone?: string; dead?: string } = {}): VerifiedFunnel => ({
      prepare: async (people) => people.filter((p) => p.lastName !== over.gone).map((p) => (p.company === over.dead ? { ...p, catchAll: true } : p)),
      hidden: (p: PersonResult) => Boolean(p.catchAll),
      findableFirst: (people) => people,
      plan: { places: [], placesOnly: false },
      finish: (items) => ({ counts: { hiddenUnverifiable: items.filter((p) => p.catchAll).length }, usage: { searchDeadDomain: items.filter((p) => p.catchAll).length }, details: ['left out'], resumed: true, nextCursor: null }),
    })
    const at = (name: string, company: string) => person({ profileUrl: `https://x/in/${name}`, name: `A ${name}`, company: { ...person().company, name: company } })

    it('keeps hidden people on the page marked, but they neither fill it nor cost a credit', async () => {
      vi.mocked(recordUsage).mockClear()
      const onPeople = vi.fn()
      const c = calls([{ found: 3, nextCursor: 3, people: [at('one', 'Good'), at('two', 'Dead'), at('three', 'Dead')] }])
      const page = await verifiedPeopleSearch({ titles: ['Founder'], count: 5 }, { onPeople }, { ...deps(c), funnel: funnel({ dead: 'Dead' }) })
      expect(page.items.map((p) => [p.lastName, Boolean(p.catchAll)])).toEqual([['one', false], ['two', true], ['three', true]])
      expect(onPeople.mock.calls[0][0].items).toHaveLength(3)
      expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ prospects: 1, prospectCredits: 1, searchShown: 1, searchDeadDomain: 2 }))
      expect(page.details).toEqual(['left out'])
      expect(page.resumed).toBe(true)
      expect(logSearch).toHaveBeenLastCalledWith(expect.objectContaining({ counts: expect.objectContaining({ hits: 3, shown: 1, hiddenUnverifiable: 2 }) }))
    })

    it('carries on past hidden people until the page is full, then cancels the search', async () => {
      const cancel = vi.fn(async () => {})
      let i = 0
      const pages = [
        { status: 'running', found: 2, nextCursor: 2, people: [at('one', 'Dead'), at('two', 'Good')] },
        { status: 'running', found: 4, nextCursor: 4, people: [at('three', 'Good'), at('four', 'Good')] },
      ]
      const c = { start: async () => ({ id: 's1' }), poll: async () => pages[i++], cancel }
      const page = await verifiedPeopleSearch({ titles: ['Founder'], count: 2 }, {}, { calls: c, sleep: async () => {}, now: () => 1_000, funnel: funnel({ dead: 'Dead' }) })
      expect(page.items.map((p) => p.lastName)).toEqual(['one', 'two', 'three'])
      expect(cancel).toHaveBeenCalledWith('s1')
      expect(logSearch).toHaveBeenLastCalledWith(expect.objectContaining({ stop: 'full' }))
    })

    it('reads what is left after the host finishes, and has nothing to cancel', async () => {
      const cancel = vi.fn(async () => {})
      let i = 0
      const pages = [
        { status: 'done', found: 2, nextCursor: 1, people: [at('one', 'Good')] },
        { status: 'done', found: 2, nextCursor: null, people: [at('two', 'Good')] },
      ]
      const c = { start: async () => ({ id: 's1' }), poll: async () => pages[i++], cancel }
      const page = await verifiedPeopleSearch({ titles: ['Founder'], count: 5 }, {}, { calls: c, sleep: async () => {}, now: () => 1_000 })
      expect(page.items).toHaveLength(2)
      expect(cancel).not.toHaveBeenCalled()
      expect(logSearch).toHaveBeenLastCalledWith(expect.objectContaining({ stop: 'done' }))
    })

    it('cancels at the time limit, and when the funnel fails', async () => {
      const cancel = vi.fn(async () => {})
      let t = 0
      const c = { start: async () => ({ id: 's1' }), poll: async () => ({ status: 'running', found: 0, nextCursor: null, people: [] }), cancel }
      await verifiedPeopleSearch({ titles: ['Founder'] }, {}, { calls: c, sleep: async () => {}, now: () => (t += 3 * 60_000) })
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(logSearch).toHaveBeenLastCalledWith(expect.objectContaining({ stop: 'time limit' }))
      const failing = { ...funnel(), prepare: async () => { throw new Error('boom') } }
      const d = { ...c, poll: async () => ({ status: 'running', found: 1, nextCursor: 1, people: [at('one', 'Good')] }) }
      await expect(verifiedPeopleSearch({ titles: ['Founder'] }, {}, { calls: d, sleep: async () => {}, now: () => 1_000, funnel: failing })).rejects.toThrow('boom')
      expect(cancel).toHaveBeenCalledTimes(2)
    })

    it('asks the host for more than the page wants, up to its most', async () => {
      const sent: any[] = []
      const c = { start: async (b: unknown) => { sent.push(b); return { id: 's1' } }, poll: async () => ({ status: 'done', found: 0, nextCursor: null, people: [] }) }
      await verifiedPeopleSearch({ titles: ['Founder'], count: 25 }, {}, { calls: c, sleep: async () => {}, now: () => 0 })
      await verifiedPeopleSearch({ titles: ['Founder'], count: 100 }, {}, { calls: c, sleep: async () => {}, now: () => 0 })
      expect(sent.map((b) => b.limit)).toEqual([100, 200])
    })

    it('sends the cities only when there are some, and carries the next cursor', async () => {
      const sent: any[] = []
      const c = { start: async (b: unknown) => { sent.push(b); return { id: 's1' } }, poll: async () => ({ status: 'done', found: 0, nextCursor: null, people: [] }) }
      const finish = vi.fn(() => ({ counts: {}, usage: {}, details: [], resumed: true, nextCursor: 'places:12' }))
      const page = await verifiedPeopleSearch({ titles: ['Founder'], cursor: 'places:6' }, {}, { calls: c, sleep: async () => {}, now: () => 0, funnel: { ...funnel(), plan: { places: ['Boston', 'Seattle'], placesOnly: true }, finish } })
      await verifiedPeopleSearch({ titles: ['Founder'] }, {}, { calls: c, sleep: async () => {}, now: () => 0 })
      expect(sent[0]).toMatchObject({ places: ['Boston', 'Seattle'], placesOnly: true })
      expect(sent[1]).not.toHaveProperty('places')
      expect(page.nextCursor).toBe('places:12')
      expect(finish).toHaveBeenCalledWith([], true)
      expect(logSearch).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ page: 'more' }), counts: expect.objectContaining({ places: 2 }) }))
    })

    it('tells the funnel when the search failed, so it keeps its place', async () => {
      const finish = vi.fn(() => ({ counts: {}, usage: {}, details: [], resumed: false, nextCursor: null }))
      const c = { start: async () => ({ id: 's1' }), poll: async () => null }
      await verifiedPeopleSearch({ titles: ['Founder'] }, {}, { calls: c, sleep: async () => {}, now: () => 0, funnel: { ...funnel(), finish } })
      expect(finish).toHaveBeenCalledWith([], false)
    })

    it('logs what the host search did as counts', async () => {
      const stats = { searches: 3, engineErrors: 1, siteIgnored: 0, candidates: 9, rejected: { 'profile unavailable': 4 } }
      const c = { start: async () => ({ id: 's1' }), poll: async () => ({ status: 'done', found: 0, nextCursor: null, people: [], stats }) }
      await verifiedPeopleSearch({ titles: ['Founder'] }, {}, { calls: c, sleep: async () => {}, now: () => 0 })
      expect(logSearch).toHaveBeenLastCalledWith(expect.objectContaining({ counts: expect.objectContaining({ serpSearches: 3, serpErrors: 1, candidates: 9, 'rejected: profile unavailable': 4 }) }))
    })
  })
})
