import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page, PersonResult } from './types'

// Every people search looks up each result's profile for their real title
// and employer. SocialFetch source and db are replaced by fakes.

const profiles: Record<string, Partial<PersonResult>> = {
  ana: { title: 'Lead Business Analyst', seniority: 'senior', company: 'Barclays', companyRef: '42' },
  ben: { title: 'Business Analyst', seniority: null, company: 'Acme', companyRef: '7' },
  // A current job at a company without a company page.
  cat: { title: 'Senior Business Analyst', seniority: 'senior', company: 'Cat Consulting', companyRef: null },
  // Profile with no current position.
  dan: { title: '', company: '', companyRef: null },
}
const getPerson = vi.fn(async (url: string): Promise<PersonResult | null> => {
  const handle = url.split('/in/')[1]
  const p = profiles[handle]
  if (!p) return null
  return {
    profileUrl: url, firstName: handle, lastName: 'Smith', title: '', seniority: null, company: '', companyRef: null,
    companyDomain: null, country: 'United Kingdom', source: 'socialfetch', ...p,
  }
})
let searchPage: Page<PersonResult>
const searchPeopleMock = vi.fn(async () => structuredClone(searchPage))
let companyPage: any
const searchCompaniesMock = vi.fn(async () => structuredClone(companyPage))
vi.mock('./runtime', () => ({ getSource: () => ({ getPerson, searchPeople: searchPeopleMock, searchCompanies: searchCompaniesMock }) }))
let suppressedHashes = new Set<string>()
let allowance: any = null
let prospectingSettings: { show_unverifiable?: boolean } | null = null
let emailDomains: Record<string, { catch_all: boolean | null; catch_all_checked_at: string | null; accepts_mail: boolean | null }> = {}
vi.mock('../db', () => ({
  db: {
    getAllowance: () => allowance,
    getProspectCompany: (ref: string) =>
      ref === '42' ? { ref, name: 'Barclays', domain: 'barclays.com', headcount: 80000 } : ref === '7' ? { ref, name: 'Acme', domain: 'acme.com', headcount: 30 } : null,
    getSuppressionHashes: () => suppressedHashes,
    getEmailDomain: (d: string) => (emailDomains[d] ? { domain: d, ...emailDomains[d] } : null),
    getDisclosures: () => disclosures,
    upsertProspectCompanies: () => {},
    getProspectingSettings: () => prospectingSettings,
    data: { get contacts() { return contacts } },
  },
}))
let disclosures: Array<{ event: string; profile_hash: string | null; contact_hash: string }> = []
let contacts: Array<{ email: string; job_title: string; company: string; email_status?: string }> = []

const { searchPeople, searchCompanies } = await import('./search')
const { hashesFor, emailHash, profileHash } = await import('./suppression')

const hit = (handle: string, title = 'Business Analyst'): PersonResult => ({
  profileUrl: `https://www.linkedin.com/in/${handle}`,
  firstName: handle, lastName: 'Smith', title, seniority: null,
  company: '', companyRef: null, companyDomain: null, country: 'United Kingdom', source: 'socialfetch',
})
const pageOf = (...items: PersonResult[]): Page<PersonResult> => ({ items, nextCursor: null, reportedTotal: 100, warnings: [] })

beforeEach(() => {
  getPerson.mockClear()
  allowance = null
  suppressedHashes = new Set()
  emailDomains = {}
  prospectingSettings = null
  disclosures = []
  contacts = []
})

describe('searchPeople with a plan allowance', () => {
  it('asks for no more people than the plan has prospect credits for', async () => {
    allowance = { periodStart: '2026-10-15T00:00:00Z', periodEnd: null, upgradeUrl: null, limits: { prospects: 100 }, used: { ...{ prospects: 0, reveals: 0, emailsSent: 0 }, prospects: 98.6 } }
    searchPage = pageOf(hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ana'])
    expect((searchPeopleMock.mock.calls.at(-1) as unknown[])[1]).toMatchObject({ count: 1 })
    expect(res.warnings).toContain('Your plan has 1 prospect credit left this month, so this page asks for at most about that many people. Upgrade to get more.')
  })

  it('stops before searching when none are left', async () => {
    allowance = { periodStart: '2026-10-15T00:00:00Z', periodEnd: null, upgradeUrl: null, limits: { prospects: 100 }, used: { ...{ prospects: 0, reveals: 0, emailsSent: 0 }, prospects: 100 } }
    const calls = searchPeopleMock.mock.calls.length
    await expect(searchPeople({ titles: ['Business Analyst'] })).rejects.toThrow(/used all 100 prospect credits/)
    expect(searchPeopleMock.mock.calls.length).toBe(calls)
  })
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

  it("uses the profile's title and employer even when the company has no company page", async () => {
    searchPage = pageOf(hit('cat', 'Analyst | Consultant | Speaker'), hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.refined).toEqual(['https://www.linkedin.com/in/cat', 'https://www.linkedin.com/in/ana'])
    const cat = res.items[0]
    expect([cat.title, cat.seniority, cat.company, cat.companyRef, cat.profileChecked]).toEqual(['Senior Business Analyst', 'senior', 'Cat Consulting', null, true])
    expect(res.warnings).toEqual([])
  })

  it('keeps looking up the rest when the first person has no current job listed', async () => {
    searchPage = pageOf(hit('dan'), hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson).toHaveBeenCalledTimes(3)
    expect(res.refined).toEqual(['https://www.linkedin.com/in/ana', 'https://www.linkedin.com/in/ben'])
    expect(res.items[0].title).toBe('Business Analyst') // the headline's, as nothing better is known
    expect(res.warnings).toEqual(['1 profile has no current job listed; showing the headline instead.'])
  })

  it('hides people who turn out to work somewhere other than the chosen company', async () => {
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: '7', name: 'Acme' } })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(res.warnings).toContain("1 person doesn't currently work at Acme and was left out.")
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

  it('in a hosted copy, also marks companies another copy there found out about', async () => {
    emailDomains = {}
    Object.assign(process.env, { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })
    const asked: any[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const { companies } = JSON.parse(String(init.body))
      asked.push(...companies)
      return Response.json({ companies: companies.map((c: any) => ({ ...c, catchAll: c.ref === '7' })) })
    }) as unknown as typeof fetch
    try {
      searchPage = pageOf(hit('ana'), hit('ben'))
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(res.items.map((p) => [p.company, p.catchAll ?? false])).toEqual([
        ['Barclays', false],
        ['Acme', true],
      ])
      // Company refs and domains only, nothing about the people.
      expect(asked).toEqual([{ ref: '42', domain: 'barclays.com' }, { ref: '7', domain: 'acme.com' }])
    } finally {
      globalThis.fetch = realFetch
      for (const k of ['PROSPECTING_MANAGED', 'REACHER_URL', 'REACHER_SECRET']) delete process.env[k]
    }
  })

  it("doesn't trust a catch-all result older than 180 days", async () => {
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

describe('searchCompanies catch-all marking', () => {
  it('marks companies whose mail domain is known to accept every address, from the cache only', async () => {
    emailDomains = { 'natwest.com': { catch_all: true, catch_all_checked_at: new Date().toISOString(), accepts_mail: true } }
    const company = (ref: string, name: string, domain: string | null) => ({
      ref, name, domain, industry: null, headcount: null, companyType: null, country: null, linkedinUrl: null, source: 'socialfetch',
    })
    companyPage = { items: [company('4777', 'NatWest', 'natwest.com'), company('9', 'Acme', 'acme.com'), company('10', 'No Site', null)], nextCursor: null, reportedTotal: 3, warnings: [] }
    const res = await searchCompanies({ keyword: 'bank' })
    expect(res.items.map((c) => [c.name, c.catchAll ?? false])).toEqual([
      ['NatWest', true],
      ['Acme', false],
      ['No Site', false],
    ])
  })
})

describe('searchPeople hidden surnames', () => {
  it('leaves out people whose surname is only an initial, before paying for their profile', async () => {
    const initialOnly = { ...hit('ana'), lastName: 'C.' }
    searchPage = pageOf(initialOnly, hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/ben'])
    expect(res.warnings).toContain('1 person was left out because LinkedIn hides their surname (e.g. "Andy C."), so no email can be found.')
  })
})

describe('searchPeople fills the page', () => {
  const withCursor = (page: Page<PersonResult>, cursor: string | null) => ({ ...page, nextCursor: cursor })

  it('runs another search page when people are left out, so the page still has as many as asked for', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock
      .mockImplementationOnce(async () => withCursor(pageOf({ ...hit('ana'), lastName: 'C.' }, hit('ben')), 'c1'))
      .mockImplementationOnce(async () => pageOf(hit('cat')))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 2 })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben', 'cat'])
    expect(searchPeopleMock).toHaveBeenCalledTimes(2)
    // The top-up continues from where the first page ended, asking only for what's missing.
    expect((searchPeopleMock.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>)[1][1]).toMatchObject({ cursor: 'c1', count: 1 })
    expect(res.warnings).toContain('Some results were left out, so 1 more search page was run to fill this page (3 credits each).')
  })

  it('stops after three extra searches and says so', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementation(async () => withCursor(pageOf({ ...hit(`x${Math.random()}`), lastName: 'C.' }), 'more'))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 1 })
    expect(searchPeopleMock).toHaveBeenCalledTimes(4)
    expect(res.items).toEqual([])
    expect(res.warnings).toContain('Found 0 of 1 after 4 searches. Load more to keep looking.')
    expect(res.warnings).toContain('4 people were left out because LinkedIn hides their surnames (e.g. "Andy C."), so no email can be found.')
    // A hosted copy shows the results and Load more, without the tally.
    process.env.PROSPECTING_MANAGED = 'on'
    try {
      expect((await searchPeople({ titles: ['Business Analyst'], count: 1 })).warnings.join(' ')).not.toContain('Found 0 of 1')
    } finally {
      delete process.env.PROSPECTING_MANAGED
    }
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })

  it('with unverifiable people hidden, does not count them and fills the page from the next search', async () => {
    prospectingSettings = { show_unverifiable: false }
    searchPeopleMock.mockClear()
    emailDomains = { 'barclays.com': { catch_all: true, catch_all_checked_at: new Date().toISOString(), accepts_mail: true } }
    searchPeopleMock
      .mockImplementationOnce(async () => withCursor(pageOf(hit('ana')), 'c1'))
      .mockImplementationOnce(async () => pageOf(hit('ben')))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 1 })
    // Ana (catch-all) is still returned, marked, for "Show them"; Ben fills the page.
    expect(res.items.map((p) => [p.firstName, p.catchAll ?? false])).toEqual([
      ['ana', true],
      ['ben', false],
    ])
    expect(searchPeopleMock).toHaveBeenCalledTimes(2)
  })

  it('by default lists unverifiable people, marked, and counts them like everyone else', async () => {
    searchPeopleMock.mockClear()
    emailDomains = { 'barclays.com': { catch_all: true, catch_all_checked_at: new Date().toISOString(), accepts_mail: true } }
    searchPeopleMock.mockImplementationOnce(async () => withCursor(pageOf(hit('ana')), 'c1'))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 1 })
    expect(res.items.map((p) => [p.firstName, p.catchAll ?? false])).toEqual([['ana', true]])
    expect(searchPeopleMock).toHaveBeenCalledTimes(1)
  })

  it('runs a page over 50 as more than one request, without calling them top-ups', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementation(async (_company: unknown, f: any) =>
      withCursor(pageOf(...Array.from({ length: f.count }, (_, i) => ({ ...hit('ben'), profileUrl: `https://www.linkedin.com/in/ben-${f.cursor ?? 'a'}-${i}` }))), 'next'),
    )
    const res = await searchPeople({ titles: ['Business Analyst'], count: 75 })
    expect(searchPeopleMock.mock.calls.map((c: any[]) => c[1].count)).toEqual([50, 25])
    expect(res.items).toHaveLength(75)
    expect(res.warnings.join(' ')).not.toMatch(/more search page/)
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })

  it('does not top up when the first page is already full', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementationOnce(async () => withCursor(pageOf(hit('ana'), hit('ben')), 'c1'))
    await searchPeople({ titles: ['Business Analyst'], count: 2 })
    expect(searchPeopleMock).toHaveBeenCalledTimes(1)
  })
})

describe('searchPeople in a workspace run by its host', () => {
  it('keeps only the notes the user can act on, not how the page was put together', async () => {
    process.env.PROSPECTING_MANAGED = 'on'
    try {
      searchPage = { ...pageOf(hit('dan'), hit('ana')), warnings: ['Only the first 5 job titles were searched.'], details: ['1 person was hidden.'] }
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(res.warnings).toEqual(['Only the first 5 job titles were searched.'])
    } finally {
      delete process.env.PROSPECTING_MANAGED
    }
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.warnings).toEqual(['Only the first 5 job titles were searched.', '1 person was hidden.', '1 profile has no current job listed; showing the headline instead.'])
  })
})

describe('searchPeople by company size', () => {
  it("keeps people whose employer is one of the sizes, from the company cache, and leaves out the rest", async () => {
    searchPage = pageOf(hit('ana'), hit('ben'), hit('cat'))
    const res = await searchPeople({ titles: ['Business Analyst'], companySizes: ['11-50'] })
    // Ben's Acme has 30 staff; Barclays is far bigger; Cat's employer has no company page to size.
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(res.warnings).toContain("2 people's employers aren't one of the chosen sizes, or couldn't be sized, and were left out.")
  })
})
