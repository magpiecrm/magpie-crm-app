import { describe, expect, it, vi } from 'vitest'
import { verifiedPeopleSearch } from './verifiedPeopleSource'

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
    expect(sent).toEqual({ titles: ['Sales Manager'], locations: ['GB'], industries: ['Financial Services'], sizes: ['1', '2-10', '51-200'], limit: 10 })
  })
})
