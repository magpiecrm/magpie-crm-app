import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page, PersonResult } from './types'

// Every people search looks up each result's profile for their real title
// and employer. SocialFetch source and db are replaced by fakes.

const profiles: Record<string, Partial<PersonResult>> = {
  ana: { title: 'Lead Business Analyst', seniority: 'senior', company: 'Barclays', companyRef: '42' },
  ben: { title: 'Business Analyst', seniority: null, company: 'Acme', companyRef: '7' },
  // Profile with no current position.
  cat: { title: 'Business Analyst', company: '', companyRef: null },
}
const getPerson = vi.fn(async (url: string): Promise<PersonResult | null> => {
  const handle = url.split('/in/')[1]
  const p = profiles[handle]
  if (!p) return null
  return {
    profileUrl: url, firstName: handle, lastName: 'X', title: '', seniority: null, company: '', companyRef: null,
    companyDomain: null, country: 'United Kingdom', source: 'socialfetch', ...p,
  }
})
let searchPage: Page<PersonResult>
const searchPeopleMock = vi.fn(async () => structuredClone(searchPage))
vi.mock('./runtime', () => ({ getSource: () => ({ getPerson, searchPeople: searchPeopleMock }) }))
let suppressedHashes = new Set<string>()
vi.mock('../db', () => ({
  db: {
    getProspectCompany: (ref: string) => (ref === '42' ? { ref, name: 'Barclays', domain: 'barclays.com' } : null),
    getSuppressionHashes: () => suppressedHashes,
  },
}))

const { searchPeople } = await import('./search')
const { hashesFor } = await import('./suppression')

const hit = (handle: string, title = 'Business Analyst'): PersonResult => ({
  profileUrl: `https://www.linkedin.com/in/${handle}`,
  firstName: handle, lastName: 'X', title, seniority: null,
  company: '', companyRef: null, companyDomain: null, country: 'United Kingdom', source: 'socialfetch',
})
const pageOf = (...items: PersonResult[]): Page<PersonResult> => ({ items, nextCursor: null, reportedTotal: 100, warnings: [] })

beforeEach(() => {
  getPerson.mockClear()
  suppressedHashes = new Set()
})

describe('searchPeople profile lookups', () => {
  it('replaces headline titles with each profile’s current position and employer', async () => {
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.refined).toEqual(['https://www.linkedin.com/in/ana', 'https://www.linkedin.com/in/ben'])
    expect(res.items.map((p) => [p.title, p.company, p.companyDomain])).toEqual([
      ['Lead Business Analyst', 'Barclays', 'barclays.com'],
      ['Business Analyst', 'Acme', null],
    ])
    expect(res.warnings).toEqual([])
    // Marked so saving doesn't pay for the same lookup again.
    expect(res.items.every((p) => p.profileChecked)).toBe(true)
  })

  it('keeps looking up the rest when the first person simply has no company page', async () => {
    searchPage = pageOf(hit('cat'), hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson).toHaveBeenCalledTimes(3)
    expect(res.refined).toEqual(['https://www.linkedin.com/in/ana', 'https://www.linkedin.com/in/ben'])
    expect(res.warnings).toEqual(['1 profile has no current job listed; showing the headline instead.'])
  })

  it('hides people who turn out to work somewhere other than the chosen company', async () => {
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: '7', name: 'Acme' } })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(res.warnings).toContain("1 person doesn't currently work at Acme and was hidden.")
  })

  it('keeps the results when profile lookups fail, instead of failing the search', async () => {
    searchPage = pageOf(hit('ana'), hit('ben'))
    getPerson.mockRejectedValueOnce(new Error('SocialFetch credits are exhausted.'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    // The failure stops the page: the rest would fail the same way.
    expect(getPerson).toHaveBeenCalledTimes(1)
    expect(res.items).toHaveLength(2)
    expect(res.refined).toEqual([])
    expect(res.warnings[0]).toMatch(/credits are exhausted/)
    // A failed lookup isn't marked checked, so saving can try again.
    expect(res.items[0].profileChecked).toBeUndefined()
  })

  it('never pays to look up someone who opted out', async () => {
    searchPage = pageOf(hit('ana'), hit('ben'))
    suppressedHashes = new Set(hashesFor({ profileUrl: 'https://www.linkedin.com/in/ana' }).map((h) => h.hash))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(getPerson).toHaveBeenCalledTimes(1)
    expect(getPerson).toHaveBeenCalledWith('https://www.linkedin.com/in/ben')
  })
})
