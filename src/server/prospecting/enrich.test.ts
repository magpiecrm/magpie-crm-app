import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileUnconfirmed, type CompanyResult, type Page, type PersonResult } from './types'

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
const defaultGetPerson = async (url: string): Promise<PersonResult | null> => {
  const handle = url.split('/in/')[1]
  const p = profiles[handle]
  if (!p) return null
  return {
    profileUrl: url, firstName: handle, lastName: 'Smith', title: '', seniority: null, company: '', companyRef: null,
    companyDomain: null, country: 'United Kingdom', source: 'socialfetch', ...p,
  }
}
const getPerson = vi.fn(defaultGetPerson)
let searchPage: Page<PersonResult>
const searchPeopleMock = vi.fn(async () => structuredClone(searchPage))
let companyPage: any
const searchCompaniesMock = vi.fn(async () => structuredClone(companyPage))
// Company pages by ref, for checking where someone really works.
let employers: Record<string, Partial<CompanyResult>> = {}
const getCompanyMock = vi.fn(async (ref: string): Promise<CompanyResult | null> =>
  employers[ref] ? { ref, name: '', domain: null, industry: null, headcount: null, companyType: null, country: null, linkedinUrl: null, source: 'socialfetch', ...employers[ref] } : null,
)
// Checks of companies' mail servers (screenCompanies): which domains accept every address.
let catchAllDomains = new Set<string>()
// And which mail servers block the check, answering neither way.
let silentDomains = new Set<string>()
vi.mock('./runtime', () => ({
  getSource: () => ({ getPerson, searchPeople: searchPeopleMock, searchCompanies: searchCompaniesMock, getCompany: getCompanyMock }),
  getFinderDeps: async () => ({
    getDomain: (d: string) => (emailDomains[d] ? { domain: d, ...emailDomains[d] } : null),
    updateDomain: (d: string, patch: any) => {
      emailDomains[d] = { ...{ catch_all: null, catch_all_checked_at: null, accepts_mail: null }, ...emailDomains[d], ...patch }
      return { domain: d, ...emailDomains[d] }
    },
    resolveMx: async () => ['mx.example'],
    verifier: {
      acquire: async () => ({ proxy: null, report: () => {} }),
      check: async (email: string) =>
        silentDomains.has(email.split('@')[1])
          ? { reachability: 'unknown', isCatchAll: null, outcome: 'blocked' }
          : { reachability: catchAllDomains.has(email.split('@')[1]) ? 'safe' : 'invalid', isCatchAll: null, outcome: 'ok' },
    },
    now: () => Date.now(),
  }),
}))
let suppressedHashes = new Set<string>()
let allowance: any = null
let prospectingSettings: { hide_unverifiable?: boolean } | null = null
let unverifiable: Array<{ hash: string; outcome: string; created_at: string }> = []
let emailDomains: Record<string, { catch_all: boolean | null; catch_all_checked_at: string | null; accepts_mail: boolean | null }> = {}
vi.mock('../db', () => ({
  db: {
    getAllowance: () => allowance,
    getProspectCompany: (ref: string) =>
      ref === '42' ? { ref, name: 'Barclays', domain: 'barclays.com', headcount: 80000 } : ref === '7' ? { ref, name: 'Acme', domain: 'acme.com', headcount: 30 } : null,
    getSuppressionHashes: () => suppressedHashes,
    getEmailDomain: (d: string) => (emailDomains[d] ? { domain: d, ...emailDomains[d] } : null),
    knownAddressesAt: () => [],
    getDisclosures: () => disclosures,
    upsertProspectCompanies: () => {},
    addSearchLog: (entry: any) => void searchLog.push(entry),
    getProspectingSettings: () => prospectingSettings,
    getUnverifiable: () => unverifiable,
    data: { get contacts() { return contacts }, get prospect_companies() { return prospectCompanies }, get campaign_recipients() { return recipients } },
    getSearchPosition: (key: string) => positions.get(key) ?? null,
    setSearchPosition: (key: string, cursor: string | null) => (cursor ? positions.set(key, cursor) : positions.delete(key)),
    getCompanySite: (key: string) => companySites.get(key) ?? null,
    setCompanySite: (key: string, domain: string | null) => void companySites.set(key, { domain, at: new Date().toISOString() }),
  },
}))
// Hiring and funding answers by company key (companySignals.ts), and what was asked.
let webSignalAnswers: Record<string, any[]> = {}
const companySignalsMock = vi.fn(async (companies: Array<{ name: string; domain?: string | null }>) => {
  const { signalKey } = await import('./signals')
  const signals: Record<string, any[]> = {}
  for (const c of companies) {
    const key = signalKey(c)!
    if (webSignalAnswers[key]) signals[key] = webSignalAnswers[key]
  }
  return { signals, pending: [] as string[] }
})
vi.mock('./companySignals', async (original) => ({ ...(await original<any>()), companySignals: (...args: any[]) => (companySignalsMock as any)(...args) }))
const positions = new Map<string, string>()
// What each search was for and what came of it (searchLog.ts).
const searchLog: any[] = []
const companySites = new Map<string, { domain: string | null; at: string }>()
let disclosures: Array<{ event: string; profile_hash: string | null; contact_hash: string }> = []
let contacts: Array<{ email: string; job_title: string; company: string; email_status?: string; first_name?: string; last_name?: string }> = []
let prospectCompanies: Array<{ ref: string; name: string; domain: string | null; headcount?: number | null }> = []
// Campaign results, for the Warm signal (warmAccounts.ts).
let recipients: any[] = []
const recordUsage = vi.fn()
vi.mock('../usage', async (original) => {
  const actual: any = await original()
  return { ...actual, recordUsage: (...args: any[]) => (recordUsage(...args), actual.recordUsage(...args)) }
})

const { searchPeople, searchCompanies } = await import('./search')
const { forgetCompanyGuesses } = await import('./companies')
const { forgetWarmIndex } = await import('./warmAccounts')
const { hashesFor, emailHash, profileHash } = await import('./suppression')

const hit = (handle: string, title = 'Business Analyst'): PersonResult => ({
  profileUrl: `https://www.linkedin.com/in/${handle}`,
  firstName: handle, lastName: 'Smith', title, seniority: null,
  company: '', companyRef: null, companyDomain: null, country: 'United Kingdom', source: 'socialfetch',
})
/** The note when a search runs out of people before the page is full. */
const allFound = (n: number) => `That's everyone this search found: ${n} of the 25 asked for. Broader job titles or fewer filters will find more.`
const pageOf = (...items: PersonResult[]): Page<PersonResult> => ({ items, nextCursor: null, reportedTotal: 100, warnings: [] })

beforeEach(() => {
  employers = {}
  getCompanyMock.mockClear()
  forgetCompanyGuesses()
  companySites.clear()
  getPerson.mockClear()
  getPerson.mockImplementation(defaultGetPerson)
  allowance = null
  suppressedHashes = new Set()
  emailDomains = {}
  prospectingSettings = null
  unverifiable = []
  disclosures = []
  contacts = []
  prospectCompanies = []
  recipients = []
  forgetWarmIndex()
  webSignalAnswers = {}
  companySignalsMock.mockClear()
  catchAllDomains = new Set()
  silentDomains = new Set()
  recordUsage.mockClear()
  positions.clear()
})

describe('searchPeople with a plan allowance', () => {
  it('asks for no more people than the plan has prospect credits for', async () => {
    allowance = { periodStart: '2026-10-15T00:00:00Z', periodEnd: null, upgradeUrl: null, limits: { prospects: 100 }, used: { ...{ prospects: 0, reveals: 0, emailsSent: 0 }, prospects: 98.6 } }
    searchPage = pageOf(hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ana'])
    expect((searchPeopleMock.mock.calls.at(-1) as unknown[])[1]).toMatchObject({ count: 1 })
    expect(res.warnings).toContain('Your plan has 1 prospect credit left this month, so this page shows at most that many people. Upgrade to get more.')
  })

  it('takes results per page as the people on the page, however many job titles are searched', async () => {
    // Five titles and a page of 25: each title's search is asked for five, not 25.
    const titles = ['Founder', 'Owner', 'CEO', 'Managing Director', 'President']
    const everyone = Array.from({ length: 30 }, (_, i) => `p${i}`)
    for (const h of everyone) profiles[h] = { title: 'Founder', seniority: 'founder', company: 'Acme', companyRef: '7' }
    try {
      searchPage = pageOf(...everyone.map((h) => hit(h, 'Founder')))
      const res = await searchPeople({ titles, count: 25 })
      expect((searchPeopleMock.mock.calls.at(-1) as unknown[])[1]).toMatchObject({ count: 5 })
      // The searches came back with 30 between them: the page stops at the 25 asked for, and charges for those.
      expect(res.items).toHaveLength(25)
      expect(res.refined).toHaveLength(25)
      expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ prospects: 25, prospectCredits: 25 })

      // One title and a page of 50: all 50 from the one search.
      searchPage = pageOf(hit('ana'))
      await searchPeople({ titles: ['Business Analyst'], count: 50, fromStart: true })
      expect((searchPeopleMock.mock.calls.at(-1) as unknown[])[1]).toMatchObject({ count: 50 })
    } finally {
      for (const h of everyone) delete profiles[h]
    }
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
    expect(res.warnings).toEqual([allFound(2)])
    // Marked so saving doesn't pay for the same lookup again.
    expect(res.items.every((p) => p.profileChecked)).toBe(true)
  })

  it("takes an employer named without its company page to be the one company known by that name", async () => {
    prospectCompanies = [{ ref: '77', name: 'Cat Consulting Ltd', domain: 'catconsulting.co.uk' }]
    searchPage = pageOf(hit('cat'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => [p.company, p.companyRef, p.companyDomain, p.noCompany ?? false])).toEqual([['Cat Consulting', '77', 'catconsulting.co.uk', false]])
    expect(res.warnings).toEqual([allFound(1)])
  })

  it('shows people with no company page, marked, when unverifiable people are shown', async () => {
    prospectingSettings = { hide_unverifiable: false }
    searchPage = pageOf(hit('cat'), hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => [p.firstName, p.noCompany ?? false])).toEqual([['cat', true], ['ana', false]])
    expect(res.warnings).toEqual([allFound(2), "1 person's profile doesn't link their employer's company page, so there's no website to find an email on."])
    expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ prospects: 2 })
  })

  it("uses the profile's title and employer even when the company has no company page", async () => {
    searchPage = pageOf(hit('cat', 'Analyst | Consultant | Speaker'), hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.refined).toEqual(['https://www.linkedin.com/in/cat', 'https://www.linkedin.com/in/ana'])
    const cat = res.items[0]
    expect([cat.title, cat.seniority, cat.company, cat.companyRef, cat.profileChecked]).toEqual(['Senior Business Analyst', 'senior', 'Cat Consulting', null, true])
    // No company page means no website to find an email on: marked, and not counted while such people are hidden.
    expect(cat.noCompany).toBe(true)
    expect(res.warnings).toEqual([allFound(1), "1 person's profile doesn't link their employer's company page, so there's no website to find an email on."])
  })

  it('keeps looking up the rest when the first person has no current job listed', async () => {
    searchPage = pageOf(hit('dan'), hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson).toHaveBeenCalledTimes(3)
    expect(res.refined).toEqual(['https://www.linkedin.com/in/ana', 'https://www.linkedin.com/in/ben'])
    expect(res.items[0].title).toBe('Business Analyst') // the headline's, as nothing better is known
    expect(res.warnings).toEqual([allFound(2), '1 profile has no current job listed, so there is no company to find an email at.'])
  })

  it('hides people who turn out to work somewhere other than the chosen company', async () => {
    searchPage = pageOf(hit('ana'), hit('ben'))
    // A company known only by its page name is searched by name, so where people work is checked.
    const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: 'acme-ltd', name: 'Acme' } })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(res.warnings).toContain("1 person doesn't currently work at Acme and was left out.")
  })

  it("doesn't take a short name shared by hundreds of firms for the company searched, nor a profile named for a business", async () => {
    const saved = { ...profiles }
    // Typed with no company page, as LinkedIn files them under MCS Management Consulting & Selection.
    profiles.mia = { title: 'Owner', seniority: 'owner', company: 'MCS Inc', companyRef: null }
    profiles.mo = { title: 'President', seniority: 'c_suite', company: 'mcs', companyRef: null }
    profiles.max = { title: 'President', seniority: 'c_suite', company: 'MCS Management Corp', companyRef: null }
    // Linking a page, or typing the firm's own longer name, still counts.
    profiles.meg = { title: 'Founder', seniority: 'founder', company: 'MCS Management Consulting & Selection', companyRef: '4410' }
    profiles.mel = { title: 'Partner', seniority: 'partner', company: 'MCS Management Consulting & Selection Ltd', companyRef: null }
    profiles.biz = { title: 'Business Owner', seniority: 'owner', company: 'Business Exit Advisors', companyRef: null }
    try {
      searchPage = pageOf(...['mia', 'mo', 'max', 'meg', 'mel'].map((h) => hit(h, 'Owner')), { ...hit('biz', 'Owner'), firstName: 'Business', lastName: 'Exit Advisors' })
      const res = await searchPeople({ titles: ['Owner'], company: { ref: 'mcs-consulting', name: 'MCS Management Consulting & Selection' } })
      expect(res.items.map((p) => p.firstName)).toEqual(['meg', 'mel'])
      // With no company chosen, the business's own profile still isn't shown as a person.
      searchPage = pageOf({ ...hit('biz', 'Owner'), firstName: 'Business', lastName: 'Exit Advisors' }, hit('ana', 'Owner'))
      const anyone = await searchPeople({ titles: ['Owner'], fromStart: true })
      expect(anyone.items.map((p) => p.firstName)).toEqual(['ana'])
    } finally {
      for (const key of Object.keys(profiles)) if (!(key in saved)) delete profiles[key]
    }
  })

  it('keeps someone who holds several jobs when one at the chosen company has a title searched for, and shows that job', async () => {
    const ana = profiles.ana
    // Her profile lists Barclays first; she's also an analyst at Acme.
    profiles.ana = { ...ana, otherJobs: [{ title: 'Business Analyst, Acme Ltd', company: 'Acme Ltd', companyRef: '7' }] }
    try {
      searchPage = pageOf(hit('ana'), hit('ben'))
      const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: 'acme-ltd', name: 'Acme' } })
      expect(res.items.map((p) => [p.firstName, p.title, p.company, p.companyRef, p.companyDomain, 'otherJobs' in p])).toEqual([
        ['ana', 'Business Analyst', 'Acme Ltd', '7', 'acme.com', false],
        ['ben', 'Business Analyst', 'Acme', '7', 'acme.com', false],
      ])
      expect(res.warnings.join(' ')).not.toMatch(/currently work at Acme/)
      // A second job there with another title, that her headline doesn't name: maybe one she never ended, so not taken.
      profiles.ana = { ...ana, otherJobs: [{ title: 'Founder, Acme Ltd', company: 'Acme Ltd', companyRef: '7' }] }
      searchPage = pageOf(hit('ana'), hit('ben'))
      const stale = await searchPeople({ titles: ['Business Analyst'], company: { ref: 'acme-ltd', name: 'Acme' }, fromStart: true })
      expect(stale.items.map((p) => p.firstName)).toEqual(['ben'])
      // Searching Barclays instead, she's shown in the job there.
      searchPage = pageOf(hit('ana'))
      const there = await searchPeople({ titles: ['Business Analyst'], company: { ref: 'barclays', name: 'Barclays' }, fromStart: true })
      expect(there.items.map((p) => [p.title, p.company])).toEqual([['Lead Business Analyst', 'Barclays']])
    } finally {
      profiles.ana = ana
    }
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

describe('searchPeople pays for no profile it can tell is wasted', () => {
  const now = new Date().toISOString()

  it('inside one company searched by its LinkedIn id, takes everyone as working there, with no profile lookups', async () => {
    searchPage = pageOf(hit('ana'), { ...hit('ben', 'Head of Sales at Acme'), company: 'Acme', companyRef: '7' })
    const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: '7', name: 'Acme' } })
    expect(getPerson).not.toHaveBeenCalled()
    expect(res.items.map((p) => [p.firstName, p.title, p.company, p.companyRef, p.companyDomain])).toEqual([
      ['ana', 'Business Analyst', 'Acme', '7', 'acme.com'],
      ['ben', 'Head of Sales at Acme', 'Acme', '7', 'acme.com'],
    ])
    // Headline titles, so not marked as checked against the profile.
    expect(res.refined).toEqual([])
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searchProfiles: 0, searchNoLookup: 2, prospects: 2 }))
  })

  it('still leaves out existing contacts found inside the company, for free', async () => {
    contacts = [{ email: 'ana@acme.com', job_title: 'BA', company: 'Acme', first_name: 'ana', last_name: 'Smith' }]
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: '7', name: 'Acme' } })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(getPerson).not.toHaveBeenCalled()
  })

  it('in a companies-first search, takes people whose headline names one of the companies, and looks up the rest', async () => {
    companyPage = { items: [{ ref: '42', name: 'Barclays', domain: 'barclays.com', industry: 'Banking', headcount: 30, companyType: null, country: 'United Kingdom', linkedinUrl: null, source: 'socialfetch' }], nextCursor: null, reportedTotal: null, warnings: [] }
    searchPage = pageOf({ ...hit('eve', 'Analyst at Barclays UK'), company: 'Barclays UK' }, hit('ana'))
    const res = await searchPeople({ titles: ['Analyst'], companySizes: ['11-50'], industries: ['Banking'] })
    expect(getPerson).toHaveBeenCalledTimes(1)
    expect(getPerson).toHaveBeenCalledWith('https://www.linkedin.com/in/ana')
    expect(res.items.map((p) => [p.firstName, p.companyRef])).toEqual([
      ['eve', '42'],
      ['ana', '42'],
    ])
  })

  it('marks people at a company where the workspace found interest, and with Warm chosen searches only those companies', async () => {
    const lately = new Date(Date.now() - 3 * 86_400_000).toISOString()
    recipients = [{ campaign_id: 1, contact_email: 'someone@acme.com', status: 'clicked', opened_at: lately, clicked_at: lately, sent_at: lately }]
    prospectCompanies = [{ ref: '7', name: 'Acme', domain: 'acme.com', headcount: 30 }]
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    // Ben's profile says Acme (ref 7): its domain is acme.com, where someone clicked.
    expect(res.items.map((p) => [p.firstName, p.signals?.map((s) => s.label) ?? []])).toEqual([
      ['ana', []],
      ['ben', ['Warm · 1 click']],
    ])

    // Warm chosen: no company search; the people search is inside Acme.
    searchCompaniesMock.mockClear()
    searchPeopleMock.mockClear()
    searchPage = pageOf(hit('ben'))
    const warm = await searchPeople({ titles: ['Business Analyst'], signals: ['warm'], fromStart: true })
    expect(searchCompaniesMock).not.toHaveBeenCalled()
    expect((searchPeopleMock.mock.calls[0] as unknown[])[1]).toMatchObject({ companyRefs: ['7'] })
    expect(warm.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(warm.warnings.join(' ')).toMatch(/Searched inside your warm companies: 1 company/)
    expect(warm.warnings.join(' ')).toMatch(/That's everyone at your warm companies: 1 person of the 25 asked for/)
    expect(warm.warnings.join(' ')).not.toMatch(/Every company matching/)
    // A size the warm company isn't: nothing to search, said plainly.
    searchPeopleMock.mockClear()
    const small = await searchPeople({ titles: ['Business Analyst'], signals: ['warm'], companySizes: ['1-10'], fromStart: true })
    expect(searchPeopleMock).not.toHaveBeenCalled()
    expect(small.items).toEqual([])
  })

  it('with Hiring chosen, finds companies first and searches only those hiring, giving their people the badge', async () => {
    const hiring = { kind: 'hiring', label: 'Hiring · 4 open roles', source: 'web' }
    companyPage = {
      items: [
        { ref: '42', name: 'Barclays', domain: 'barclays.com', industry: 'Banking', headcount: 30, companyType: null, country: 'United Kingdom', linkedinUrl: null, source: 'socialfetch' },
        { ref: '7', name: 'Acme', domain: 'acme.com', industry: 'Banking', headcount: 30, companyType: null, country: 'United Kingdom', linkedinUrl: null, source: 'socialfetch' },
      ],
      nextCursor: null,
      reportedTotal: null,
      warnings: [],
    }
    prospectCompanies = [
      { ref: '42', name: 'Barclays', domain: 'barclays.com' },
      { ref: '7', name: 'Acme', domain: 'acme.com' },
    ]
    webSignalAnswers = { 'acme.com': [hiring] }
    searchPeopleMock.mockClear()
    searchPage = pageOf(hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'], industries: ['Banking'], signals: ['hiring'] })
    // Only Acme is searched inside.
    expect((searchPeopleMock.mock.calls[0] as unknown[])[1]).toMatchObject({ companyRefs: ['7'] })
    expect(res.items.map((p) => [p.firstName, p.signals?.map((s) => s.label)])).toEqual([['ben', ['Hiring · 4 open roles']]])
    expect(res.warnings).toContain('1 company was passed over for showing none of the signals chosen, before anyone there was searched for.')
    // Without an industry or keyword there are no companies to find.
    await expect(searchPeople({ titles: ['Business Analyst'], signals: ['hiring'] })).rejects.toThrow(/need an industry or keyword/)
  })

  it('carries on past pages of companies that are all left out, rather than ending the search', async () => {
    let call = 0
    searchCompaniesMock.mockImplementation(async () => {
      call++
      // Four pages of companies with no LinkedIn id (left out), then one to search inside.
      const company = call <= 4 ? { ref: `page-${call}`, name: `Nameless ${call}` } : { ref: '7', name: 'Acme' }
      return {
        items: [{ ...company, domain: null, industry: 'Banking', headcount: 30, companyType: null, country: 'United Kingdom', linkedinUrl: null, source: 'socialfetch' }],
        nextCursor: call < 6 ? `org-${call}` : null,
        reportedTotal: 1000,
        warnings: [],
      } as any
    })
    try {
      searchPeopleMock.mockClear()
      searchPage = pageOf(hit('ben'))
      const res = await searchPeople({ titles: ['Business Analyst'], industries: ['Banking'], companySizes: ['11-50'] })
      expect(call).toBeGreaterThanOrEqual(5)
      expect((searchPeopleMock.mock.calls[0] as unknown[])[1]).toMatchObject({ companyRefs: ['7'] })
      expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    } finally {
      searchCompaniesMock.mockImplementation(async () => structuredClone(companyPage))
    }
  })

  it("doesn't show someone again on Load more whom an earlier page of the same search showed", async () => {
    // Found by one title's request on the first page and another's on the next.
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementationOnce(async () => ({ ...pageOf(hit('ana')), nextCursor: 'p2' }))
    searchPeopleMock.mockImplementationOnce(async () => ({ ...pageOf(hit('ana'), hit('ben')), nextCursor: null }))
    try {
      const first = await searchPeople({ titles: ['Business Analyst'], count: 1, fromStart: true })
      expect(first.items.map((p) => p.firstName)).toEqual(['ana'])
      const more = await searchPeople({ titles: ['Business Analyst'], count: 1, cursor: first.nextCursor! })
      expect(more.items.map((p) => p.firstName)).toEqual(['ben'])
    } finally {
      searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
    }
  })

  it('fills a short page with people in related roles, after the exact matches and marked, unless that’s switched off', async () => {
    const ben = profiles.ben
    profiles.ben = { ...ben, title: 'Sales Executive' }
    try {
      // Ana has the title searched; Ben only works in the same department.
      searchPage = pageOf(hit('ben', 'Sales Executive'), hit('ana'))
      searchPage.items[0] = { ...searchPage.items[0], related: true }
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(res.items.map((p) => [p.firstName, p.related ?? false])).toEqual([
        ['ana', false],
        ['ben', true],
      ])
      expect(res.warnings).toContain('Too few people here have the job titles searched, so 1 person in related roles in the same department follows them, marked "Related role".')
      // A page the exact matches fill has no room for them, and their profiles aren't read.
      getPerson.mockClear()
      const full = await searchPeople({ titles: ['Business Analyst'], count: 1, fromStart: true })
      expect(full.items.map((p) => p.firstName)).toEqual(['ana'])
      expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/ana'])
      // Switched off: none.
      const off = await searchPeople({ titles: ['Business Analyst'], relatedRoles: false, fromStart: true })
      expect(off.items.map((p) => p.firstName)).toEqual(['ana'])
    } finally {
      profiles.ben = ben
    }
  })

  it('with New in role chosen, keeps only people whose job started lately, and counts the rest', async () => {
    const thisMonth = new Date().toISOString().slice(0, 7)
    const ana = profiles.ana
    profiles.ana = { ...ana, roleStartedOn: thisMonth }
    try {
      searchPage = pageOf(hit('ana'), hit('ben'))
      const res = await searchPeople({ titles: ['Business Analyst'], signals: ['new_in_role'] })
      expect(res.items.map((p) => p.firstName)).toEqual(['ana'])
      expect(res.items[0].signals?.[0]).toMatchObject({ kind: 'new_in_role', at: thisMonth })
      expect(res.warnings).toContain('1 person was left out for having none of the signals chosen.')
    } finally {
      profiles.ana = ana
    }
  })

  it("doesn't place someone at a company because they typed what they do as their employer and a company goes by that word", async () => {
    // An agency called Clean. LinkedIn's search files everyone who typed "clean" under it.
    companyPage = { items: [{ ref: '55', name: 'Clean', domain: 'cleanagency.com', industry: 'Banking', headcount: 30, companyType: null, country: 'United Kingdom', linkedinUrl: null, source: 'socialfetch' }], nextCursor: null, reportedTotal: null, warnings: [] }
    profiles.eve = { title: 'Owner', seniority: 'owner', company: 'clean', companyRef: null }
    profiles.fay = { title: 'Owner', seniority: 'owner', company: 'Clean.', companyRef: null }
    profiles.gus = { title: 'Owner', seniority: 'owner', company: 'Food Industry', companyRef: null }
    // Someone whose profile links the agency's own page does work there.
    profiles.hal = { title: 'Owner', seniority: 'owner', company: 'Clean', companyRef: '55' }
    try {
      searchPage = pageOf(hit('eve', 'Owner'), hit('fay', 'Owner'), hit('gus', 'Owner'), hit('hal', 'Owner'))
      const res = await searchPeople({ titles: ['Owner'], companySizes: ['11-50'], industries: ['Banking'] })
      expect(res.items.map((p) => [p.firstName, p.companyRef])).toEqual([['hal', '55']])

      // The same in a search inside one company, known here by its page name, so where people work is checked by name.
      searchPage = pageOf(hit('eve', 'Owner'), hit('hal', 'Owner'))
      const inside = await searchPeople({ titles: ['Owner'], company: { ref: 'clean-agency', name: 'Clean' } })
      expect(inside.items.map((p) => p.firstName)).toEqual(['hal'])
    } finally {
      for (const h of ['eve', 'fay', 'gus', 'hal']) delete profiles[h]
    }
  })

  it("leaves out, before paying for them, people whose headline says they've left their job", async () => {
    searchPage = pageOf(hit('fay', 'Former CFO'), hit('gus', 'Ex-Googler, now Head of Sales'), hit('ana'), hit('hal', 'Open to Work'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/gus', 'https://www.linkedin.com/in/ana'])
    expect(res.items.map((p) => p.firstName)).toEqual(['gus', 'ana'])
    expect(res.warnings).toContain('2 people were left out because their headlines say they have left their job (e.g. "Former …"), and no profile lookup was paid for.')
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searchSkippedNotWorking: 2, searchProfiles: 2 }))
  })

  it("leaves out, before paying for them, people whose headline names a company where nothing can be verified, only while they're hidden", async () => {
    prospectCompanies = [{ ref: '7', name: 'Acme Ltd', domain: 'acme.com' }]
    emailDomains = { 'acme.com': { catch_all: true, catch_all_checked_at: now, accepts_mail: true } }
    searchPage = pageOf({ ...hit('ben', 'Analyst at Acme'), company: 'Acme' }, hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/ana'])
    expect(res.items.map((p) => p.firstName)).toEqual(['ana'])
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searchSkippedUnverifiable: 1 }))

    prospectingSettings = { hide_unverifiable: false }
    getPerson.mockClear()
    await searchPeople({ titles: ['Business Analyst'], fromStart: true })
    expect(getPerson).toHaveBeenCalledTimes(2)
  })

  it('leaves out, before paying for them, contacts with the same name at the company their headline names', async () => {
    contacts = [{ email: 'ben@acme.com', job_title: 'BA', company: 'Acme Ltd', first_name: 'ben', last_name: 'Smith' }]
    searchPage = pageOf({ ...hit('ben', 'Analyst at Acme'), company: 'Acme' }, hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/ana'])
    expect(res.warnings.join(' ')).toContain("1 person was left out because they're already in your contacts.")
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searchSkippedContact: 1, searchPaidInContacts: 0 }))
  })

  it('counts the profiles paid for and why any of them were left out', async () => {
    emailDomains = { 'acme.com': { catch_all: true, catch_all_checked_at: now, accepts_mail: true } }
    contacts = [{ email: 'cat@x.test', job_title: '', company: 'Cat Consulting', first_name: 'cat', last_name: 'Smith' }]
    searchPage = pageOf(hit('ana'), hit('ben'), hit('cat'))
    await searchPeople({ titles: ['Business Analyst'] })
    // Ben's profile shows Acme, which accepts every address (hidden); Cat is a contact.
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ searchProfiles: 3, searchPaidUnverifiable: 1, searchPaidInContacts: 1, searchPaidWrongCompany: 0, prospects: 1 }),
    )
  })
})

describe('searchPeople with profiles that can’t be confirmed', () => {
  /** A lookup of these handles can't be confirmed, the first `times` times each is asked. */
  const unconfirmedFor = (handles: string[], times = Infinity) => {
    const asked = new Map<string, number>()
    getPerson.mockImplementation(async (url: string) => {
      const handle = url.split('/in/')[1]
      const n = (asked.get(handle) ?? 0) + 1
      asked.set(handle, n)
      if (handles.includes(handle) && n <= times) throw new ProfileUnconfirmed()
      return defaultGetPerson(url)
    })
    return asked
  }

  it('leaves them out after asking once more, quietly, and charges nothing for them', async () => {
    const asked = unconfirmedFor(['zed'])
    searchPage = pageOf(hit('ana'), hit('zed'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ana', 'ben'])
    expect(asked.get('zed')).toBe(2)
    expect(res.warnings).toEqual([allFound(2)])
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searchProfiles: 2, prospects: 2 }))
  })

  it('shows them when the second ask confirms them', async () => {
    unconfirmedFor(['ana'], 1)
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => [p.firstName, p.company])).toEqual([
      ['ben', 'Acme'],
      ['ana', 'Barclays'],
    ])
    expect(res.refined).toContain('https://www.linkedin.com/in/ana')
    expect(res.warnings.join(' ')).not.toContain("couldn't be read")
  })

  it('searches on for others in their place, and asks about them again only if the page is still short', async () => {
    const asked = unconfirmedFor(['zed'])
    searchPeopleMock.mockClear()
    searchPeopleMock
      .mockImplementationOnce(async () => ({ ...pageOf(hit('ana'), hit('zed')), nextCursor: 'c1' }))
      .mockImplementationOnce(async () => pageOf(hit('ben')))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 2 } as any)
    expect(searchPeopleMock).toHaveBeenCalledTimes(2)
    expect(res.items.map((p) => p.firstName)).toEqual(['ana', 'ben'])
    // The page filled up without them: not asked about again.
    expect(asked.get('zed')).toBe(1)
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })

  it('stops searching when no profile in a batch can be confirmed, as more searching would confirm none either', async () => {
    const handles = Array.from({ length: 10 }, (_, i) => `p${i}`)
    unconfirmedFor(handles)
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementationOnce(async () => ({ ...pageOf(...handles.map((h) => hit(h))), nextCursor: 'c1' }))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    // The next page may have been started ahead, but no one on it is looked up, and no one is asked about again.
    expect(getPerson).toHaveBeenCalledTimes(10)
    expect(res.items).toEqual([])
    expect(res.warnings).toContain("Profiles can't be checked right now, so this page stopped at 0 of the 25 asked for. Load more in a few minutes to carry on.")
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })
})

describe('searchPeople when the data source fails partway', () => {
  it('keeps the people found so far, and what they cost, and carries on from the same place on Load more', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock
      .mockImplementationOnce(async () => ({ ...pageOf(hit('ana')), nextCursor: 'c1' }))
      .mockImplementationOnce(async () => {
        throw new Error('SocialFetch is busy (503).')
      })
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ana'])
    expect(res.nextCursor).toBe('c1')
    expect(res.warnings).toContain('The people data source is busy right now, so this page stopped at 1 of the 25 asked for. Load more in a minute to carry on.')
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ prospects: 1, searchProfiles: 1 }))
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })

  it('fails as before when it fails before finding anyone', async () => {
    searchPeopleMock.mockImplementationOnce(async () => {
      throw new Error('SocialFetch is busy (503).')
    })
    await expect(searchPeople({ titles: ['Business Analyst'] })).rejects.toThrow('busy')
    expect(recordUsage).not.toHaveBeenCalled()
  })
})

describe('searchPeople counts only paid search requests', () => {
  it('records no search request for a page served from people already held', async () => {
    searchPeopleMock.mockImplementationOnce(async () => ({ ...pageOf(hit('ana')), requests: 0 }))
    await searchPeople({ titles: ['Business Analyst'] })
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searches: 0 }))
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

describe('searchPeople and people who couldn\'t be verified', () => {
  it('leaves out people an earlier lookup couldn\'t verify, before paying for their profile', async () => {
    unverifiable = [{ hash: profileHash('https://www.linkedin.com/in/ana')!, outcome: 'rejected', created_at: new Date().toISOString() }]
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(getPerson).not.toHaveBeenCalledWith('https://www.linkedin.com/in/ana')
  })

  it('forgets them after 90 days, and looks them up while hiding is turned off', async () => {
    unverifiable = [{ hash: profileHash('https://www.linkedin.com/in/ana')!, outcome: 'rejected', created_at: new Date(Date.now() - 91 * 86_400_000).toISOString() }]
    searchPage = pageOf(hit('ana'))
    expect((await searchPeople({ titles: ['Business Analyst'] })).items.map((p) => p.firstName)).toEqual(['ana'])
    unverifiable[0].created_at = new Date().toISOString()
    prospectingSettings = { hide_unverifiable: false }
    expect((await searchPeople({ titles: ['Business Analyst'] })).items.map((p) => p.firstName)).toEqual(['ana'])
  })

  it('marks people at a company whose domain is known to take no email', async () => {
    const now = new Date().toISOString()
    emailDomains = { 'barclays.com': { catch_all: null, catch_all_checked_at: null, accepts_mail: false, mx_checked_at: now } as any }
    prospectingSettings = { hide_unverifiable: false }
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => [p.company, p.noMail ?? false])).toEqual([
      ['Barclays', true],
      ['Acme', false],
    ])
  })
})

describe('searchPeople and people seen before', () => {
  it('leaves out people already in contacts by default, paying for no profile lookup', async () => {
    contacts = [{ email: 'ana.x@barclays.com', job_title: 'Head of Analytics', company: 'Barclays', email_status: 'verified' }]
    disclosures = [{ event: 'saved', profile_hash: profileHash('https://www.linkedin.com/in/ana'), contact_hash: emailHash('ana.x@barclays.com') }]
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/ben'])
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(res.warnings).toContain('1 person was left out because they\'re already in your contacts. Turn on "Include existing contacts" to see them.')
  })

  it('leaves out a contact added another way once their profile shows the same name at the same company', async () => {
    // Imported, not saved from a search: no profile hash to match on.
    contacts = [{ email: 'ana.smith@barclays.com', first_name: 'Ana', last_name: 'Smith', job_title: '', company: 'Barclays' }]
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(res.warnings).toContain('1 person was left out because they\'re already in your contacts. Turn on "Include existing contacts" to see them.')

    const included = await searchPeople({ titles: ['Business Analyst'], includeContacts: true })
    expect(included.items.map((p) => p.firstName)).toEqual(['ana', 'ben'])
  })

  it('searches again to fill the page when contacts are left out', async () => {
    contacts = [{ email: 'ana.x@barclays.com', job_title: 'Head of Analytics', company: 'Barclays' }]
    disclosures = [{ event: 'saved', profile_hash: profileHash('https://www.linkedin.com/in/ana'), contact_hash: emailHash('ana.x@barclays.com') }]
    const pages = [{ ...pageOf(hit('ana'), hit('ben')), nextCursor: 'p2' }, pageOf(hit('cat'))]
    searchPeopleMock.mockImplementationOnce(async () => structuredClone(pages[0])).mockImplementationOnce(async () => structuredClone(pages[1]))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 2 })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben', 'cat'])
  })

  it('with existing contacts included, fills an already-saved person from their contact and pays for no profile lookup', async () => {
    contacts = [{ email: 'ana.x@barclays.com', job_title: 'Head of Analytics', company: 'Barclays', email_status: 'verified' }]
    disclosures = [{ event: 'saved', profile_hash: profileHash('https://www.linkedin.com/in/ana'), contact_hash: emailHash('ana.x@barclays.com') }]
    searchPage = pageOf(hit('ana'), hit('ben'))
    const res = await searchPeople({ titles: ['Business Analyst'], includeContacts: true })
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

  it('stops after ten extra searches when nothing found is worth paying for, and says so', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementation(async () => withCursor(pageOf({ ...hit(`x${Math.random()}`), lastName: 'C.' }), 'more'))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 1 })
    // Hidden surnames are left out for free, so the page stays under its usual cost.
    expect(searchPeopleMock).toHaveBeenCalledTimes(11)
    expect(res.items).toEqual([])
    expect(res.warnings).toContain('Found 0 of 1 after 11 searches. Load more to keep looking.')
    expect(res.warnings).toContain('11 people were left out because LinkedIn hides their surnames (e.g. "Andy C."), so no email can be found.')
    // A hosted copy shows the results and Load more, without the tally.
    process.env.PROSPECTING_MANAGED = 'on'
    try {
      expect((await searchPeople({ titles: ['Business Analyst'], count: 1 })).warnings.join(' ')).not.toContain('Found 0 of 1')
    } finally {
      delete process.env.PROSPECTING_MANAGED
    }
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })

  it('by default hides unverifiable people and fills the page from the next search', async () => {
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

  it('with hiding turned off, lists unverifiable people, marked, like everyone else', async () => {
    prospectingSettings = { hide_unverifiable: false }
    searchPeopleMock.mockClear()
    emailDomains = { 'barclays.com': { catch_all: true, catch_all_checked_at: new Date().toISOString(), accepts_mail: true } }
    searchPeopleMock.mockImplementationOnce(async () => withCursor(pageOf(hit('ana')), 'c1'))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 1 })
    expect(res.items.map((p) => [p.firstName, p.catchAll ?? false])).toEqual([['ana', true]])
    expect(searchPeopleMock).toHaveBeenCalledTimes(1)
  })

  it('runs a page over 50 as more than one request, without calling them top-ups', async () => {
    searchPeopleMock.mockClear()
    const fullPage = async (_company: unknown, f: { count: number; cursor?: string }) =>
      withCursor(pageOf(...Array.from({ length: f.count }, (_, i) => ({ ...hit('ben'), profileUrl: `https://www.linkedin.com/in/ben-${f.cursor ?? 'a'}-${i}` }))), 'next')
    searchPeopleMock.mockImplementation(fullPage as unknown as () => Promise<Page<PersonResult>>)
    // Everyone found works at Acme, so each has somewhere to find an email.
    getPerson.mockImplementation(async (url: string) => ({ ...(await defaultGetPerson('https://www.linkedin.com/in/ben'))!, profileUrl: url }))
    try {
      const res = await searchPeople({ titles: ['Business Analyst'], count: 75 })
      expect(searchPeopleMock.mock.calls.map((c: any[]) => c[1].count)).toEqual([50, 25])
      expect(res.items).toHaveLength(75)
      expect(res.warnings.join(' ')).not.toMatch(/more search page/)
    } finally {
      getPerson.mockImplementation(defaultGetPerson)
      searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
    }
  })

  it('hands over each batch of people as soon as it is ready, before the page is done', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementation((async (_c: unknown, f: { cursor?: string }) => (f.cursor ? pageOf(hit('cat')) : withCursor(pageOf(hit('ana')), 'p2'))) as any)
    try {
      const batches: string[][] = []
      const res = await searchPeople({ titles: ['Business Analyst'], count: 25 }, { onPeople: (f) => batches.push(f.items.map((p) => p.firstName)) })
      expect(batches).toEqual([['ana'], ['cat']])
      expect(res.items.map((p) => p.firstName)).toEqual(['ana', 'cat'])
    } finally {
      searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
    }
  })

  it("starts the next search page while this page's profiles are looked up, when the page can't be full without it", async () => {
    searchPeopleMock.mockClear()
    const order: string[] = []
    getPerson.mockImplementation((async (url: string) => {
      order.push(`lookup ${url.split('/in/')[1]}`)
      await new Promise((r) => setTimeout(r, 20))
      return null
    }) as any)
    searchPeopleMock.mockImplementation((async (_c: unknown, f: { cursor?: string }) => {
      order.push(`search ${f.cursor ?? 'first'}`)
      return f.cursor ? pageOf(hit('cat')) : withCursor(pageOf(hit('ana')), 'p2')
    }) as any)
    try {
      const res = await searchPeople({ titles: ['Business Analyst'], count: 25 })
      expect(order.slice(0, 3)).toEqual(['search first', 'search p2', 'lookup ana'])
      expect(res.items.map((p) => p.firstName)).toEqual(['ana', 'cat'])
      expect(searchPeopleMock).toHaveBeenCalledTimes(2)
    } finally {
      searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
      getPerson.mockImplementation(defaultGetPerson)
    }
  })

  it('does not top up when the first page is already full', async () => {
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementationOnce(async () => withCursor(pageOf(hit('ana'), hit('ben')), 'c1'))
    await searchPeople({ titles: ['Business Analyst'], count: 2 })
    expect(searchPeopleMock).toHaveBeenCalledTimes(1)
  })
})

describe('searchPeople testing mail domains before people are shown', () => {
  const funnel = (log: { mock: { calls: unknown[][] } }) => JSON.parse(String(log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('Search funnel'))).split('Search funnel ')[1])

  it('hides people at a domain that turns out to accept every address, and remembers what it learned', async () => {
    catchAllDomains = new Set(['barclays.com'])
    searchPage = pageOf(hit('ana'), hit('ben'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(res.items.map((p) => [p.firstName, p.companyDomain, Boolean(p.catchAll)])).toEqual([['ana', 'barclays.com', true], ['ben', 'acme.com', false]])
      expect(funnel(log)).toMatchObject({ domainsCheckedAhead: 2, domainsNotChecked: 0, hiddenUnverifiable: 1, shown: 1, prospectCredits: 1 })
      // Kept for the Reveal that follows, which doesn't test the domain again.
      expect(emailDomains['barclays.com']).toMatchObject({ catch_all: true })
      expect(emailDomains['acme.com']).toMatchObject({ catch_all: false, accepts_mail: true })
    } finally {
      log.mockRestore()
    }
  })

  it("hides people at a domain whose mail server won't answer the test, until it's due another try", async () => {
    silentDomains = new Set(['barclays.com'])
    searchPage = pageOf(hit('ana'), hit('ben'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(res.items.map((p) => [p.firstName, Boolean(p.noAnswer)])).toEqual([['ana', true], ['ben', false]])
      expect(funnel(log)).toMatchObject({ mailServerSilent: 1, hiddenUnverifiable: 1, shown: 1, prospectCredits: 1 })
      // Not asked again by the next search: the same answer stands for a day.
      const before = JSON.stringify(emailDomains['barclays.com'])
      await searchPeople({ titles: ['Business Analyst'], fromStart: true })
      expect(JSON.stringify(emailDomains['barclays.com'])).toBe(before)
    } finally {
      log.mockRestore()
    }
  })

  it('logs what the search was for and what came of it, never who, and marks each person with the search', async () => {
    searchLog.length = 0
    catchAllDomains = new Set(['barclays.com'])
    searchPage = pageOf(hit('ana'), hit('ben'), hit('dan'))
    const res = await searchPeople({ titles: ['Business Analyst'], country: 'United Kingdom', industries: ['Banking'], keyword: 'treasury' })
    expect(searchLog).toHaveLength(1)
    const [entry] = searchLog
    expect(entry.filters).toEqual({ titles: ['Business Analyst'], seniorities: [], industries: ['Banking'], sizes: [], country: 'United Kingdom', company: null, keyword: true, page: 'first' })
    expect(entry.counts).toMatchObject({ hits: 3, shown: 1, hiddenUnverifiable: 2, boughtNoJob: 1, profilesBought: 3 })
    expect(entry.lookups).toEqual({})
    expect(entry.ms).toBeGreaterThanOrEqual(0)
    // Nobody's name, profile or employer.
    expect(JSON.stringify(entry)).not.toMatch(/\bana\b|\bben\b|Smith|linkedin|barclays|acme/i)
    // Each person carries the search's id, so a Reveal can count against it.
    expect(new Set(res.items.map((p) => p.searchId))).toEqual(new Set([entry.id]))
    // And the month's counts have what the yield is worked out from.
    expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ searchHits: 3, searchShown: 1, prospects: 1, searchNoJob: 1, searchDeadDomain: 1, searchNoSite: 0 })
  })

  it('tests nothing where such people are shown anyway', async () => {
    prospectingSettings = { hide_unverifiable: false }
    catchAllDomains = new Set(['barclays.com'])
    searchPage = pageOf(hit('ana'))
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.items.map((p) => [p.firstName, p.companyDomain, Boolean(p.catchAll)])).toEqual([['ana', 'barclays.com', false]])
    expect(emailDomains).toEqual({})
  })
})

describe('searchPeople in a workspace run by its host', () => {
  it('keeps only the notes the user can act on, not how the page was put together', async () => {
    process.env.PROSPECTING_MANAGED = 'on'
    try {
      searchPage = { ...pageOf(hit('dan'), hit('ana')), warnings: ['Only the first 5 job titles were searched.'], details: ['1 person was hidden.'] }
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(res.warnings).toEqual(['Only the first 5 job titles were searched.', allFound(1)])
    } finally {
      delete process.env.PROSPECTING_MANAGED
    }
    const res = await searchPeople({ titles: ['Business Analyst'] })
    expect(res.warnings).toEqual([
      'Only the first 5 job titles were searched.',
      allFound(1),
      '1 person was hidden.',
      '1 profile has no current job listed, so there is no company to find an email at.',
    ])
  })
})

describe("searchPeople with the host's shared database", () => {
  const ENV = { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' }
  const url = (handle: string) => `https://www.linkedin.com/in/${handle}`
  /** A host holding these people: handle → what it knows. */
  function hosted(contributing: boolean, held: Record<string, { company: string; companyRef: string | null; verifiedAt?: string; title?: string }>) {
    Object.assign(process.env, ENV)
    ;(globalThis as any).__hostRules = { rules: {}, pool: { canJoin: true, search: true, contributing, byDefault: false, termsVersion: '1', termsUrl: null } }
    const asked: string[][] = []
    vi.stubGlobal('fetch', async (target: string, init: RequestInit) => {
      if (!String(target).endsWith('/v1/pool/known')) return Response.json({})
      const profiles: string[] = JSON.parse(String(init.body)).profiles
      asked.push(profiles)
      return Response.json({
        people: Object.entries(held)
          .filter(([handle]) => profiles.includes(profileHash(url(handle))!))
          .map(([handle, k]) => ({
            profile: profileHash(url(handle)), handle: `handle-${handle}`, title: k.title ?? 'Head of Analysis', seniority: 'head', company: k.company, companyRef: k.companyRef,
            companyDomain: 'barclays.com', country: 'United Kingdom', verifiedAt: k.verifiedAt ?? new Date().toISOString(),
          })),
      })
    })
    return asked
  }
  const unhost = () => {
    for (const k of Object.keys(ENV)) delete process.env[k]
    delete (globalThis as any).__hostRules
    vi.unstubAllGlobals()
  }

  it("takes someone it holds from it, with no profile bought, and looks everyone else up", async () => {
    const asked = hosted(true, { ana: { company: 'Barclays', companyRef: '42' } })
    try {
      searchPage = pageOf(hit('ana'), hit('ben'))
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(asked).toHaveLength(1)
      expect(getPerson.mock.calls.map((c) => c[0])).toEqual([url('ben')])
      expect(res.items.map((p) => [p.firstName, p.title, p.company, p.companyRef, p.shared, p.profileChecked])).toEqual([
        ['ana', 'Head of Analysis', 'Barclays', '42', 'handle-ana', true],
        ['ben', 'Business Analyst', 'Acme', '7', undefined, true],
      ])
      expect(res.refined).toEqual([url('ben'), url('ana')])
      // A credit for each person shown, wherever their details came from.
      expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ sharedPeople: 1, searchProfiles: 1, prospectCredits: 2 })
    } finally {
      unhost()
    }
  })

  it("charges a copy that doesn't contribute a credit for the person shown, like anyone else", async () => {
    hosted(false, { ana: { company: 'Barclays', companyRef: '42' } })
    try {
      searchPage = pageOf(hit('ana'))
      await searchPeople({ titles: ['Business Analyst'] })
      expect(getPerson).not.toHaveBeenCalled()
      expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ sharedPeople: 1, prospectCredits: 1 })
    } finally {
      unhost()
    }
  })

  describe('where the host’s profile lookups are free', () => {
    const free = () => {
      hosted(true, {})
      ;(globalThis as any).__hostRules.profileLookupsFree = true
    }
    const barclays = { items: [{ ref: '42', name: 'Barclays', domain: 'barclays.com', industry: 'Banking', headcount: 30, companyType: null, country: 'United Kingdom', linkedinUrl: null, source: 'socialfetch' as const }], nextCursor: null, reportedTotal: null, warnings: [] }

    it('looks everyone up in a companies-first search, and keeps someone working elsewhere when that fits the filters', async () => {
      free()
      try {
        employers = { '7': { name: 'Acme', domain: 'acme.com', industry: 'Banking', headcount: 30 } }
        companyPage = barclays
        // Eve's headline names Barclays, which would have been taken without a lookup.
        searchPage = pageOf({ ...hit('eve', 'Analyst at Barclays UK'), company: 'Barclays UK' }, hit('ana'), hit('ben'))
        const res = await searchPeople({ titles: ['Analyst'], companySizes: ['11-50'], industries: ['Banking'] })
        expect(getPerson).toHaveBeenCalledTimes(3)
        // Ben works at Acme, not Barclays: a bank of 11-50 too, so he's kept, at Acme.
        expect(res.items.map((p) => [p.firstName, p.company, p.companyDomain])).toEqual([
          // Her profile didn't say, but the name is the company searched inside, so that's taken as her employer.
          ['eve', 'Barclays UK', 'barclays.com'],
          ['ana', 'Barclays', 'barclays.com'],
          ['ben', 'Acme', 'acme.com'],
        ])
        expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ prospects: 3, prospectCredits: 3 })
      } finally {
        unhost()
      }
    })

    it("keeps searching when few of the people looked up are kept, as there are no credits to save by stopping", async () => {
      free()
      try {
        // Page after page of twelve people found at Initech whose profiles all say they're at Acme now.
        let page = 0
        searchPeopleMock.mockClear()
        searchPeopleMock.mockImplementation(async () => {
          const n = page++
          for (let i = 0; i < 12; i++) profiles[`q${n}x${i}`] = profiles.ben
          return { ...pageOf(...Array.from({ length: 12 }, (_, i) => hit(`q${n}x${i}`))), nextCursor: `page-${n + 1}` }
        })
        getPerson.mockClear()
        const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: 'initech', name: 'Initech' } })
        // Where lookups are paid for this stops after the first page (the test above); here it carries on
        // until it has read three pages' worth of profiles (75 for a page of 25), and stops soon after.
        expect(searchPeopleMock.mock.calls.length).toBeGreaterThanOrEqual(7)
        expect(getPerson.mock.calls.length).toBeGreaterThanOrEqual(75)
        expect(getPerson.mock.calls.length).toBeLessThanOrEqual(75 + 24)
        expect(res.items).toEqual([])
        expect(res.warnings.join(' ')).not.toMatch(/to save credits/)
        expect(res.nextCursor).toBeTruthy()
      } finally {
        for (const key of Object.keys(profiles)) if (/^q\d+x/.test(key)) delete profiles[key]
        searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
        unhost()
      }
    })

    it('uses a search page it started ahead and paid for, rather than stopping without it', async () => {
      // Every search finds twelve people. The page reaches its most profiles read (75 for a page of
      // 25) with the next search already started, which it then uses: Load more won't pay for it again.
      free()
      let n = 0
      searchPeopleMock.mockClear()
      searchPeopleMock.mockImplementation(async () => {
        const i = n++
        for (let j = 0; j < 12; j++) profiles[`pf${i}x${j}`] = profiles.ben
        return { ...pageOf(...Array.from({ length: 12 }, (_, j) => hit(`pf${i}x${j}`))), nextCursor: `page-${i + 1}`, requests: 1 }
      })
      try {
        const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: 'initech', name: 'Initech' } })
        const calls = searchPeopleMock.mock.calls.length
        // Initech's people all work at Acme now, so nobody is kept: with lookups free the page searches until its limits.
        expect(res.items).toEqual([])
        // The last search it ran is the one it carries on from: none was started and dropped.
        expect(res.nextCursor).toBe(`page-${calls}`)
      } finally {
        for (const key of Object.keys(profiles)) if (/^pf\d+x/.test(key)) delete profiles[key]
        searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
        unhost()
      }
    })

    it("places someone whose profile doesn't link their employer at the page its name would have, and leaves them out when there's none", async () => {
      free()
      try {
        // Cat Consulting has a page, which her profile didn't link.
        employers = { 'cat-consulting': { ref: '77', name: 'Cat Consulting Ltd', domain: 'catconsulting.co.uk' } }
        profiles.eve = { title: 'Analyst', seniority: null, company: 'Nowhere Much', companyRef: null }
        searchPage = pageOf(hit('cat'), hit('eve'))
        const res = await searchPeople({ titles: ['Business Analyst'] })
        expect(res.items.map((p) => [p.firstName, p.companyRef, p.companyDomain, p.noCompany ?? false])).toEqual([
          ['cat', '77', 'catconsulting.co.uk', false],
          ['eve', null, null, true],
        ])
        expect(getCompanyMock.mock.calls.map((c) => [c[0], (c as unknown[])[2]])).toEqual([
          ['cat-consulting', { pageOnly: true }],
          ['nowhere-much', { pageOnly: true }],
        ])
        expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ prospects: 1 })
      } finally {
        delete profiles.eve
        unhost()
      }
    })

    it("reads a company's page for its website before showing its people, and hides them where there's none to be found", async () => {
      free()
      const { CompanyUnconfirmed } = await import('./types')
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        // Three companies nothing is known about yet: a website on its page, none there, and a page that can't be read.
        employers = { '61': { name: 'Sited', domain: 'sited.example' }, '62': { name: 'Unsited', domain: null } }
        getCompanyMock.mockImplementation(async (ref: string) => {
          if (ref === '63') throw new CompanyUnconfirmed()
          return employers[ref] ? ({ ref, name: '', domain: null, industry: null, headcount: null, companyType: null, country: null, linkedinUrl: null, source: 'socialfetch', ...employers[ref] } as CompanyResult) : null
        })
        profiles.eve = { title: 'Analyst', seniority: null, company: 'Sited', companyRef: '61' }
        profiles.fay = { title: 'Analyst', seniority: null, company: 'Unsited', companyRef: '62' }
        profiles.gil = { title: 'Analyst', seniority: null, company: 'Unread', companyRef: '63' }
        searchPage = pageOf(hit('eve'), hit('fay'), hit('gil'))
        const res = await searchPeople({ titles: ['Business Analyst'] })
        expect(res.items.map((p) => [p.firstName, p.companyDomain, p.noCompany ?? false])).toEqual([
          ['eve', 'sited.example', false],
          ['fay', null, true],
          // Nothing learned about it: shown, and its page is read when someone asks for the email.
          ['gil', null, false],
        ])
        const funnel = JSON.parse(String(log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('Search funnel'))).split('Search funnel ')[1])
        expect(funnel).toMatchObject({ companyPagesRead: 2, noWebsite: 1, hiddenUnverifiable: 1, shown: 2, prospectCredits: 2 })
        // The website found is tested like any other before its people are shown.
        expect(emailDomains['sited.example']).toMatchObject({ accepts_mail: true, catch_all: false })
      } finally {
        log.mockRestore()
        getCompanyMock.mockReset()
        getCompanyMock.mockImplementation(async (ref: string) =>
          employers[ref] ? ({ ref, name: '', domain: null, industry: null, headcount: null, companyType: null, country: null, linkedinUrl: null, source: 'socialfetch', ...employers[ref] } as CompanyResult) : null,
        )
        delete profiles.eve
        delete profiles.fay
        delete profiles.gil
        unhost()
      }
    })

    it("gives someone whose employer has no LinkedIn page the website a web search finds for it, where the host offers one", async () => {
      free()
      ;(globalThis as any).__hostRules.webSearch = true
      const searched: string[] = []
      vi.stubGlobal('fetch', async (target: string, init: RequestInit) => {
        if (!String(target).endsWith('/v1/web-search')) return Response.json({})
        const { query, country } = JSON.parse(String(init.body))
        searched.push(`${query}, from ${country}`)
        return Response.json({ results: query.includes('Cat Consulting') ? [{ url: 'https://uk.linkedin.com/company/x', title: '', description: '' }, { url: 'https://www.catconsulting.co.uk/', title: 'Cat Consulting', description: '' }] : [] })
      })
      try {
        profiles.eve = { title: 'Analyst', seniority: null, company: 'Nowhere Much', companyRef: null }
        profiles.fay = { title: 'Analyst', seniority: null, company: 'Self-employed', companyRef: null }
        profiles.gus = { title: 'Analyst', seniority: null, company: 'food industry', companyRef: null }
        searchPage = pageOf(hit('cat'), hit('eve'), hit('fay'), hit('gus'))
        const res = await searchPeople({ titles: ['Business Analyst'] })
        expect(res.items.map((p) => [p.firstName, p.companyRef, p.companyDomain, p.noCompany ?? false])).toEqual([
          ['cat', null, 'catconsulting.co.uk', false],
          ['eve', null, null, true],
          ['fay', null, null, true],
          ['gus', null, null, true],
        ])
        // The employer's name and country only; never for what isn't a company.
        expect(searched.sort()).toEqual(['Cat Consulting, from United Kingdom', 'Nowhere Much, from United Kingdom'])
        expect(recordUsage.mock.calls.at(-1)![0]).toMatchObject({ prospects: 1 })
      } finally {
        delete profiles.eve
        delete profiles.fay
        delete profiles.gus
        unhost()
      }
    })

    it('leaves out someone whose real employer doesn’t fit', async () => {
      free()
      try {
        employers = { '7': { name: 'Acme', domain: 'acme.com', industry: 'Retail', headcount: 30 } }
        companyPage = barclays
        searchPage = pageOf(hit('ana'), hit('ben'))
        const res = await searchPeople({ titles: ['Analyst'], companySizes: ['11-50'], industries: ['Banking'] })
        expect(res.items.map((p) => p.firstName)).toEqual(['ana'])
        expect(getCompanyMock).toHaveBeenCalledWith('7', null)
      } finally {
        unhost()
      }
    })
  })

  it("looks someone up after all when they may have moved on: another employer in their headline, or an old record", async () => {
    hosted(true, { ana: { company: 'Lloyds', companyRef: '99' }, ben: { company: 'Acme', companyRef: '7', verifiedAt: new Date(Date.now() - 200 * 86_400_000).toISOString() } })
    try {
      searchPage = pageOf({ ...hit('ana'), company: 'Barclays' }, hit('ben'))
      const res = await searchPeople({ titles: ['Business Analyst'] })
      expect(getPerson).toHaveBeenCalledTimes(2)
      expect(res.items.every((p) => !p.shared)).toBe(true)
    } finally {
      unhost()
    }
  })

  it('still leaves out a contact, and still searches when the host is down', async () => {
    hosted(true, { ana: { company: 'Barclays', companyRef: '42' } })
    try {
      contacts = [{ email: 'ana.smith@barclays.com', first_name: 'ana', last_name: 'Smith', job_title: 'x', company: 'Barclays' }]
      searchPage = pageOf(hit('ana'))
      expect((await searchPeople({ titles: ['Business Analyst'] })).items).toEqual([])

      contacts = []
      vi.stubGlobal('fetch', async () => Promise.reject(new Error('down')))
      const res = await searchPeople({ titles: ['Business Analyst'], fromStart: true })
      expect(res.items.map((p) => [p.firstName, p.shared])).toEqual([['ana', undefined]])
      expect(getPerson).toHaveBeenCalledTimes(1)
    } finally {
      unhost()
    }
  })
})

describe('searchPeople carries on where the last search stopped', () => {
  const cursorArg = () => (searchPeopleMock.mock.calls.at(-1) as unknown[])[1] as { cursor?: string }

  it('starts the same search again from where the last one stopped, and says so', async () => {
    searchPage = { ...pageOf(hit('ana')), nextCursor: 'after-ana' }
    const first = await searchPeople({ titles: ['Business Analyst'], count: 1 })
    expect(first.resumed).toBe(false)
    expect(cursorArg().cursor).toBeUndefined()

    searchPage = { ...pageOf(hit('ben')), nextCursor: 'after-ben' }
    // Same filters, titles in another case and order of options: the same search.
    const again = await searchPeople({ titles: ['business analyst '], count: 1 })
    expect(cursorArg().cursor).toBe('after-ana')
    expect(again.resumed).toBe(true)
    expect(again.items.map((p) => p.firstName)).toEqual(['ben'])
  })

  it('starts at the top when asked, and for different filters', async () => {
    searchPage = { ...pageOf(hit('ana')), nextCursor: 'after-ana' }
    await searchPeople({ titles: ['Business Analyst'], count: 1 })
    await searchPeople({ titles: ['Business Analyst'], count: 1, fromStart: true })
    expect(cursorArg().cursor).toBeUndefined()
    await searchPeople({ titles: ['Business Analyst'], country: 'United Kingdom', count: 1 })
    expect(cursorArg().cursor).toBeUndefined()
  })

  it('goes back to the top once the results run out', async () => {
    searchPage = { ...pageOf(hit('ana')), nextCursor: 'after-ana' }
    await searchPeople({ titles: ['Business Analyst'], count: 1 })
    searchPage = pageOf(hit('ben')) // the last page
    await searchPeople({ titles: ['Business Analyst'], count: 1 })
    await searchPeople({ titles: ['Business Analyst'], count: 1 })
    expect(cursorArg().cursor).toBeUndefined()
  })

  it('keeps searching past pages of people it skips for free, within what a page normally costs', async () => {
    // Five pages of people already in contacts, then someone new.
    contacts = [{ email: 'ana.x@barclays.com', job_title: 'Head of Analytics', company: 'Barclays' }]
    disclosures = [{ event: 'saved', profile_hash: profileHash('https://www.linkedin.com/in/ana'), contact_hash: emailHash('ana.x@barclays.com') }]
    for (let i = 0; i < 5; i++) {
      searchPeopleMock.mockImplementationOnce(async () => ({ ...pageOf(hit('ana')), nextCursor: `p${i + 1}` }))
    }
    searchPeopleMock.mockImplementationOnce(async () => pageOf(hit('ben')))
    const res = await searchPeople({ titles: ['Business Analyst'], count: 1 })
    expect(res.items.map((p) => p.firstName)).toEqual(['ben'])
    expect(searchPeopleMock.mock.calls.length).toBeGreaterThanOrEqual(6)
  })
})

describe('searchPeople stops early when its filters throw away nearly everyone paid for', () => {
  it('stops after the first page when most people turn out to work elsewhere, and says why', async () => {
    // Twelve people found at Initech whose profiles all say they're at Acme now.
    for (let i = 0; i < 12; i++) profiles[`p${i}`] = profiles.ben
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementation(async () => ({
      ...pageOf(...Array.from({ length: 12 }, (_, i) => hit(`p${i}`))),
      nextCursor: 'more',
    }))
    const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: 'initech', name: 'Initech' } })
    // The next page was started early (its people are held for Load more), but no profile there was paid for.
    expect(searchPeopleMock).toHaveBeenCalledTimes(2)
    expect(getPerson).toHaveBeenCalledTimes(12)
    expect(res.items).toEqual([])
    expect(res.warnings).toContain(
      'Working somewhere other than Initech left out 12 of the 12 people whose profiles were checked, so no more pages were searched, to save credits. Try other job titles. Load more carries on if you want to keep looking.',
    )
    expect(res.nextCursor).toBe('more')
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })

  it('keeps topping up when enough of the people paid for are kept', async () => {
    for (let i = 0; i < 12; i++) profiles[`p${i}`] = profiles.ben
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementation(async () => ({ ...pageOf(...Array.from({ length: 12 }, (_, i) => hit(`p${i}`))), nextCursor: 'more' }))
    const res = await searchPeople({ titles: ['Business Analyst'], company: { ref: '7', name: 'Acme' } })
    expect(res.warnings.join(' ')).not.toContain('no more pages were searched')
    searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
  })
})

describe('searchPeople with a company size finds companies first', () => {
  const org = (ref: string, name: string, country: string | null) => ({
    ref, name, domain: `${name.toLowerCase()}.example`, industry: 'Banking', headcount: 30, companyType: null, country, linkedinUrl: null, source: 'socialfetch',
  })

  it('needs an industry or keyword to find the companies', async () => {
    await expect(searchPeople({ titles: ['Founder'], companySizes: ['11-50'] })).rejects.toThrow(
      'Company size needs an industry or keyword, to find companies of that size first.',
    )
  })

  it('searches companies of that size in the chosen industry, then people inside them, without sizing anyone', async () => {
    searchCompaniesMock.mockClear()
    searchPeopleMock.mockClear()
    getPerson.mockClear()
    // Barclays (ref 42) is in the UK; Globex isn't, so it isn't searched.
    companyPage = { items: [org('42', 'Barclays', 'United Kingdom'), org('77', 'Globex', 'United States'), org('7', 'Acme', null)], nextCursor: null, reportedTotal: null, warnings: [] }
    searchPage = pageOf(hit('ana'), hit('cat'))
    const res = await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], industries: ['Banking'], country: 'United Kingdom' })

    expect((searchCompaniesMock.mock.calls[0] as unknown[])[0]).toMatchObject({ keyword: 'Banking', industry: 'Banking', headcount: ['11-50'], country: 'United Kingdom' })
    const asked = (searchPeopleMock.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>
    expect(asked).toMatchObject({ titles: ['Founder'], companyRefs: ['42', '7'], country: 'United Kingdom' })
    // The company's industry and keyword found the companies; they don't narrow the people.
    expect(asked.industries).toBeUndefined()
    expect(asked.keyword).toBeUndefined()
    // Ana works at Barclays (42), one of them. Cat's profile shows a company that isn't: left out.
    expect(res.items.map((p) => p.firstName)).toEqual(['ana'])
    expect(res.nextCursor).toBeNull()
  })

  it("leaves out companies where nothing can be verified before searching people there, from what's known and a check of their mail server", async () => {
    const now = new Date().toISOString()
    // Acme is known to accept every address; Globex turns out to on a check. Initech's search hit has no
    // website, as most of SocialFetch's don't, which says nothing about its mail: it's searched.
    emailDomains = { 'acme.example': { catch_all: true, catch_all_checked_at: now, accepts_mail: true } }
    catchAllDomains = new Set(['globex.example'])
    companyPage = {
      items: [org('42', 'Barclays', 'United Kingdom'), org('7', 'Acme', null), org('77', 'Globex', null), { ...org('88', 'Initech', null), domain: null }],
      nextCursor: null, reportedTotal: null, warnings: [],
    }
    searchPage = pageOf(hit('ana'))
    searchPeopleMock.mockClear()
    const res = await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], industries: ['Banking'] })
    expect(((searchPeopleMock.mock.calls.at(-1) as unknown[])[1] as { companyRefs: string[] }).companyRefs).toEqual(['42', '88'])
    expect(res.warnings).toContain(
      'Left out 2 companies whose mail servers accept every address or take no email, where no email can be verified, before searching for people there.',
    )
    // Kept for the lookups that follow.
    expect(emailDomains['globex.example'].catch_all).toBe(true)
    // Counted, for the admin portal's search yield.
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ searchOrgRequests: 1, searchCompaniesFound: 4, searchCompaniesUnverifiable: 2, searchCompaniesNoDomain: 1 }),
    )
  })

  it('says when every company matching the filters has been searched, and how many there are', async () => {
    companyPage = { items: [org('42', 'Barclays', 'United Kingdom')], nextCursor: null, reportedTotal: 60, warnings: [] }
    searchPage = pageOf({ ...hit('ana'), company: 'Barclays' })
    const res = await searchPeople({ titles: ['Founder'], companySizes: ['1-10', '11-50'], industries: ['Banking'], country: 'United Kingdom' })
    expect(res.warnings.join(' ')).toContain(
      "That's everyone at these companies: 1 of the 25 asked for. 60 companies match (Banking, 1-10, 11-50 staff, United Kingdom) in the data, and all of them have now been searched.",
    )
  })

  it("doesn't pay for the profile of someone whose headline names another employer", async () => {
    companyPage = { items: [org('42', 'Barclays', 'United Kingdom'), org('7', 'Acme', null)], nextCursor: null, reportedTotal: null, warnings: [] }
    searchPage = pageOf({ ...hit('ana'), company: 'Barclays' }, { ...hit('ben'), company: 'Globex Corp' }, hit('cat'))
    const res = await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], industries: ['Banking'] })
    // Ana's headline names Barclays (no lookup), Ben's another company (left out), Cat's none (looked up).
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/cat'])
    expect(res.items.map((p) => p.firstName)).not.toContain('ben')
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searchSkippedOtherEmployer: 1 }))
    expect(res.warnings.join(' ')).toMatch(/1 person was left out because their headline names an employer that isn't one of these companies/)
  })

  it('searches them all while unverifiable people are shown', async () => {
    prospectingSettings = { hide_unverifiable: false }
    emailDomains = { 'acme.example': { catch_all: true, catch_all_checked_at: new Date().toISOString(), accepts_mail: true } }
    companyPage = { items: [org('42', 'Barclays', 'United Kingdom'), org('7', 'Acme', null)], nextCursor: null, reportedTotal: null, warnings: [] }
    searchPage = pageOf(hit('ana'))
    searchPeopleMock.mockClear()
    await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], industries: ['Banking'] })
    expect(((searchPeopleMock.mock.calls.at(-1) as unknown[])[1] as { companyRefs: string[] }).companyRefs).toEqual(['42', '7'])
  })

  it('searches a batch again one company at a time when most of its people would need a profile lookup', async () => {
    companyPage = { items: [org('42', 'Barclays', 'United Kingdom'), org('7', 'Acme', null), org('88', 'Initech', null)], nextCursor: null, reportedTotal: null, warnings: [] }
    // Together, nobody's headline says which company: five lookups, against three single-company searches.
    const together = pageOf(hit('p1'), hit('p2'), hit('p3'), hit('p4'), hit('p5'))
    const alone: Record<string, PersonResult[]> = { '42': [hit('p1'), hit('p2')], '7': [hit('p3'), hit('p4')], '88': [hit('p5')] }
    searchPeopleMock.mockClear()
    searchPeopleMock.mockImplementation((async (company: { ref: string } | null) => (company ? pageOf(...alone[company.ref]) : structuredClone(together))) as any)
    try {
      const res = await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], industries: ['Banking'] })
      expect(getPerson).not.toHaveBeenCalled()
      expect(searchPeopleMock.mock.calls.map((c) => ((c as unknown[])[0] as { ref: string } | null)?.ref ?? 'together')).toEqual(['together', '42', '7', '88'])
      expect(res.items.map((p) => [p.firstName, p.companyRef, p.companyDomain])).toEqual([
        ['p1', '42', 'barclays.com'],
        ['p2', '42', 'barclays.com'],
        ['p3', '7', 'acme.com'],
        ['p4', '7', 'acme.com'],
        ['p5', '88', null],
      ])
      expect(res.warnings.join(' ')).toContain('Searched 3 companies one at a time')
      // Counted once each, as people found without a lookup.
      expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ searchProfiles: 0, searchNoLookup: 5, prospects: 5 }))
    } finally {
      searchPeopleMock.mockImplementation(async () => structuredClone(searchPage))
    }
  })

  it('keeps a batch together when fewer of its people need a lookup than single searches would cost', async () => {
    companyPage = { items: [org('42', 'Barclays', 'United Kingdom'), org('7', 'Acme', null), org('88', 'Initech', null)], nextCursor: null, reportedTotal: null, warnings: [] }
    searchPage = pageOf({ ...hit('ana'), company: 'Barclays' }, hit('cat'), hit('ben'))
    searchPeopleMock.mockClear()
    await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], industries: ['Banking'] })
    expect(searchPeopleMock).toHaveBeenCalledTimes(1)
    expect(getPerson.mock.calls.map((c) => c[0])).toEqual(['https://www.linkedin.com/in/cat', 'https://www.linkedin.com/in/ben'])
  })

  it('carries on with the next companies on Load more', async () => {
    const many = Array.from({ length: 25 }, (_, i) => org(String(1000 + i), `Co${i}`, 'United Kingdom'))
    companyPage = { items: many, nextCursor: null, reportedTotal: null, warnings: [] }
    searchPage = pageOf()
    searchPeopleMock.mockClear()
    const first = await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], keyword: 'fintech', country: 'United Kingdom', count: 25 })
    expect(((searchPeopleMock.mock.calls[0] as unknown[])[1] as { companyRefs: string[] }).companyRefs).toHaveLength(20)
    // The first twenty had nobody; the page tops up with the other five.
    const refs = searchPeopleMock.mock.calls.map((c) => ((c as unknown[])[1] as { companyRefs: string[] }).companyRefs)
    expect(refs[1]).toEqual(['1020', '1021', '1022', '1023', '1024'])
    expect(first.nextCursor).toBeNull()
  })

  it('keeps the cursor of a search with companies waiting well inside what Load more accepts', async () => {
    // Long company names, a page of companies held and more to come: the most a cursor carries.
    searchCompaniesMock.mockImplementation(async () => ({
      items: Array.from({ length: 25 }, (_, i) => org(String(3_000_000_000 + Math.floor(Math.random() * 1e9) + i), `${'Very Long Company Name Holdings International '.repeat(2)}${i}`, 'United Kingdom')),
      nextCursor: 'org-more',
      reportedTotal: null,
      warnings: [],
    }) as any)
    try {
      searchPage = pageOf()
      const res = await searchPeople({ titles: ['Founder', 'Owner', 'CEO', 'Managing Director', 'President'], companySizes: ['1-10'], keyword: 'fintech', count: 25 })
      expect(res.nextCursor).toBeTruthy()
      // The search API takes cursors of up to 20,000 characters (functions/prospects.ts).
      expect(res.nextCursor!.length).toBeLessThan(10_000)
    } finally {
      searchCompaniesMock.mockImplementation(async () => structuredClone(companyPage))
    }
  })

  it('fills each batch to twenty companies from the next page of companies, instead of searching the few left over alone', async () => {
    // Pages of 15 companies: 20 per batch means the first batch takes 5 from the second page.
    let call = 0
    searchCompaniesMock.mockImplementation(async () => {
      const page = call++
      return {
        items: Array.from({ length: 15 }, (_, i) => org(String(2000 + page * 15 + i), `Co${page}-${i}`, 'United Kingdom')),
        nextCursor: page < 2 ? `org-${page + 1}` : null,
        reportedTotal: null,
        warnings: [],
      } as any
    })
    try {
      searchPage = pageOf()
      searchPeopleMock.mockClear()
      const res = await searchPeople({ titles: ['Founder'], companySizes: ['11-50'], keyword: 'fintech', country: 'United Kingdom', count: 25 })
      const refs = searchPeopleMock.mock.calls.map((c) => ((c as unknown[])[1] as { companyRefs: string[] }).companyRefs)
      // 45 companies: batches of 20, 20 and the last 5, never a batch of a few with more to come.
      expect(refs.map((r) => r.length)).toEqual([20, 20, 5])
      expect(new Set(refs.flat()).size).toBe(45)
      expect(res.nextCursor).toBeNull()
    } finally {
      searchCompaniesMock.mockImplementation(async () => structuredClone(companyPage))
    }
  })

})
