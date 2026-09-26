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
let emailDomains: Record<string, { catch_all: boolean | null; catch_all_checked_at: string | null; accepts_mail: boolean | null }> = {}
vi.mock('../db', () => ({
  db: {
    getProspectCompany: (ref: string) =>
      ref === '42' ? { ref, name: 'Barclays', domain: 'barclays.com' } : ref === '7' ? { ref, name: 'Acme', domain: 'acme.com' } : null,
    getSuppressionHashes: () => suppressedHashes,
    getEmailDomain: (d: string) => (emailDomains[d] ? { domain: d, ...emailDomains[d] } : null),
    getDisclosures: () => disclosures,
    data: { get contacts() { return contacts } },
  },
}))
let disclosures: Array<{ event: string; profile_hash: string | null; contact_hash: string }> = []
let contacts: Array<{ email: string; job_title: string; company: string; email_status?: string }> = []

const { searchPeople } = await import('./search')
const { hashesFor, emailHash, profileHash } = await import('./suppression')

const hit = (handle: string, title = 'Business Analyst'): PersonResult => ({
  profileUrl: `https://www.linkedin.com/in/${handle}`,
  firstName: handle, lastName: 'X', title, seniority: null,
  company: '', companyRef: null, companyDomain: null, country: 'United Kingdom', source: 'socialfetch',
})
const pageOf = (...items: PersonResult[]): Page<PersonResult> => ({ items, nextCursor: null, reportedTotal: 100, warnings: [] })

beforeEach(() => {
  getPerson.mockClear()
  suppressedHashes = new Set()
  emailDomains = {}
  disclosures = []
  contacts = []
})

describe('searchPeople profile lookups', () => {
  it('replaces headline titles with each profile’s current position and employer', async () => {
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.refined).toEqual(['https://www.linkedin.com/in/ana', 'https://www.linkedin.com/in/ben'])
    expect(res.items.map((p) => [p.title, p.company, p.companyDomain])).toEqual([
      ['Lead Business Analyst', 'Barclays', 'barclays.com'],
      ['Business Analyst', 'Acme', 'acme.com'],
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

describe('searchPeople catch-all marking', () => {
  const now = new Date().toISOString()

  it('marks people at companies already known to accept every address, from the cache only', async () => {
    emailDomains = { 'barclays.com': { catch_all: true, catch_all_checked_at: now, accepts_mail: true } }
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => [p.company, p.catchAll ?? false])).toEqual([
      ['Barclays', true],
      ['Acme', false],
    ])
  })

  it("doesn't trust a catch-all result older than 90 days", async () => {
    emailDomains = { 'barclays.com': { catch_all: true, catch_all_checked_at: '2020-01-01T00:00:00Z', accepts_mail: true } }
    searchPage = pageOf(hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items[0].catchAll).toBeUndefined()
  })
})

describe('searchPeople and people seen before', () => {
  it('fills an already-saved person from their contact and pays for no profile lookup', async () => {
    contacts = [{ email: 'ana.x@barclays.com', job_title: 'Head of Analytics', company: 'Barclays', email_status: 'verified' }]
    disclosures = [{ event: 'saved', profile_hash: profileHash('https://www.linkedin.com/in/ana'), contact_hash: emailHash('ana.x@barclays.com') }]
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/ben'])
    expect(res.items[0]).toMatchObject({
      previously: 'saved',
      title: 'Head of Analytics',
      seniority: 'head',
      company: 'Barclays',
      email: 'ana.x@barclays.com',
      emailStatus: 'verified',
      profileChecked: true,
    })
    expect(res.items[1]).toMatchObject({ company: 'Acme' })
    expect(res.items[1].previously).toBeUndefined()
    expect(res.warnings).toContain('1 person is already in your contacts, so their details come from there and no profile lookup was paid for.')
  })

  it('looks a saved person up normally when their contact has since been deleted', async () => {
    disclosures = [{ event: 'saved', profile_hash: profileHash('https://www.linkedin.com/in/ana'), contact_hash: emailHash('gone@barclays.com') }]
    searchPage = pageOf(hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson).toHaveBeenCalledTimes(1)
    expect(res.items[0]).toMatchObject({ company: 'Barclays' })
    expect(res.items[0].previously).toBeUndefined()
  })

  it('marks people revealed before but still looks them up (their email was never kept)', async () => {
    disclosures = [{ event: 'revealed', profile_hash: profileHash('https://www.linkedin.com/in/ana'), contact_hash: 'x' }]
    searchPage = pageOf(hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson).toHaveBeenCalledTimes(1)
    expect(res.items[0]).toMatchObject({ previously: 'revealed', company: 'Barclays', companyDomain: 'barclays.com' })
    expect(res.items[0].email).toBeUndefined()
  })
})
