import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { domainFitsName, findCompanySite, siteFromResults } from './companySite'
import { decodoSearch, webSearcher, type WebResult } from './webSearch'

const result = (url: string, title = ''): WebResult => ({ url, title, description: '' })

describe('a company’s website from a web search', () => {
  it('is a domain that is plainly the company’s name, give or take a common ending', () => {
    const fits = (domain: string, name: string) => domainFitsName(domain, name)
    expect(fits('tinderboxresearch.com', 'Tinderbox Research')).toBe(true)
    expect(fits('nelson-hall.com', 'Nelson Hall Ltd')).toBe(true)
    expect(fits('acme.co.uk', 'Acme Consulting Limited')).toBe(true)
    expect(fits('acmeuk.com', 'Acme')).toBe(true)
    expect(fits('smithandjones.co.uk', 'Smith & Jones')).toBe(true)
    // Not a different company that shares a word, a short scrap, or nothing at all.
    expect(fits('acmeresearchpartners.com', 'Acme')).toBe(false)
    expect(fits('research.com', 'Tinderbox Research')).toBe(false)
    expect(fits('ab.com', 'AB')).toBe(false)
    expect(fits('acme.com', '')).toBe(false)
  })

  it('skips directories, registries and social networks, and takes the first that fits', () => {
    const results = [
      result('https://uk.linkedin.com/company/tinderbox-research'),
      result('https://find-and-update.company-information.service.gov.uk/company/01234567'),
      result('https://www.endole.co.uk/company/01234567/tinderbox-research-limited'),
      result('https://www.tinderboxresearch.com/about'),
      result('https://tinderboxresearch.co.uk/'),
    ]
    expect(siteFromResults('Tinderbox Research Ltd', results)).toBe('tinderboxresearch.com')
    expect(siteFromResults('Tinderbox Research Ltd', results.slice(0, 3))).toBeNull()
    expect(siteFromResults('Tinderbox Research Ltd', [result('https://www.somethingelse.com/tinderbox-research')])).toBeNull()
  })

  it('is searched for once per company, by its name and country only, and remembered either way', async () => {
    const kept = new Map<string, { domain: string | null; at: string }>()
    const db = { getCompanySite: (k: string) => kept.get(k) ?? null, setCompanySite: (k: string, domain: string | null) => void kept.set(k, { domain, at: new Date().toISOString() }) }
    const asked: string[] = []
    const search = async (query: string) => (asked.push(query), query.includes('Tinderbox') ? [result('https://tinderboxresearch.com/')] : [])
    const [a, b] = await Promise.all([findCompanySite('Tinderbox Research Ltd', 'United Kingdom', search, db), findCompanySite('Tinderbox Research', 'United Kingdom', search, db)])
    expect([a, b]).toEqual(['tinderboxresearch.com', 'tinderboxresearch.com'])
    expect(await findCompanySite('Nowhere Much', null, search, db)).toBeNull()
    expect(await findCompanySite('Nowhere Much', null, search, db)).toBeNull()
    expect(asked).toEqual(['"Tinderbox Research Ltd" United Kingdom', '"Nowhere Much"'])
    // Nothing found is asked about again after a month; a search that failed, next time.
    expect(await findCompanySite('Nowhere Much', null, search, db, Date.now() + 31 * 86_400_000)).toBeNull()
    expect(asked).toHaveLength(3)
    expect(await findCompanySite('Broken Search Co', null, async () => Promise.reject(new Error('down')), db)).toBeNull()
    expect(kept.has('broken search')).toBe(false)
  })
})

describe('the domain to find someone’s email on', () => {
  const person = {
    profileUrl: 'https://www.linkedin.com/in/jane', firstName: 'Jane', lastName: 'Smith', title: 'Founder', seniority: 'founder' as const,
    company: 'Tinderbox Research', companyRef: null, companyDomain: null, country: 'United Kingdom', source: 'socialfetch' as const, profileChecked: true,
  }
  const store = () => {
    const sites = new Map<string, { domain: string | null; at: string }>()
    const companies: any[] = []
    return {
      data: { prospect_companies: companies },
      getProspectCompany: (ref: string) => companies.find((c) => c.ref === ref) ?? null,
      upsertProspectCompanies: (entries: any[]) => void companies.push(...entries),
      getCompanySite: (k: string) => sites.get(k) ?? null,
      setCompanySite: (k: string, domain: string | null) => void sites.set(k, { domain, at: new Date().toISOString() }),
    } as any
  }

  it('falls back on a web search when the employer has no company page, or its page gave no website', async () => {
    const { domainForPerson, forgetCompanyGuesses } = await import('./companies')
    forgetCompanyGuesses()
    const noPages = { searchCompanies: async () => ({ items: [], nextCursor: null, reportedTotal: null, warnings: [] }), getCompany: async () => null }
    const search = async () => [result('https://tinderboxresearch.com/')]
    expect(await domainForPerson(person, noPages, store(), search)).toBe('tinderboxresearch.com')
    // A company with a page that lists no website is searched for too.
    expect(await domainForPerson({ ...person, companyRef: 'tinderbox-research' }, noPages, store(), search)).toBe('tinderboxresearch.com')
    // Without a web search, or for what isn't a company, there's nothing to go on.
    forgetCompanyGuesses()
    expect(await domainForPerson(person, noPages, store(), null)).toBeNull()
    expect(await domainForPerson({ ...person, company: 'Freelance' }, noPages, store(), search)).toBeNull()
  })
})

describe('the web search itself', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete (globalThis as any).__hostRules
    for (const k of ['PROSPECTING_MANAGED', 'REACHER_URL', 'REACHER_SECRET', 'WEB_SEARCH_API_KEY', 'WEB_SEARCH_URL']) delete process.env[k]
  })
  afterEach(() => {
    process.env = { ...saved }
    delete (globalThis as any).__hostRules
  })

  it('reads Google results from the provider, in either shape it sends them', async () => {
    const calls: Array<{ url: string; auth: string | null; body: any }> = []
    const answer = (content: unknown) =>
      (async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) })
        return Response.json({ results: [{ content }] })
      }) as unknown as typeof fetch
    const organic = [{ pos: 1, url: 'https://acme.com/', title: 'Acme', desc: 'Widgets' }, { pos: 2, url: 'not a url', title: 'x' }]
    expect(await decodoSearch('key-1', '"Acme"', { fetchImpl: answer({ results: { organic } }) })).toEqual([{ url: 'https://acme.com/', title: 'Acme', description: 'Widgets' }])
    expect(await decodoSearch('key-1', '"Acme"', { fetchImpl: answer({ results: { results: { organic } } }) })).toHaveLength(1)
    expect(calls[0]).toEqual({ url: 'https://data.decodo.com/v1/scrape', auth: 'Bearer key-1', body: { target: 'google_search', query: '"Acme"', parse: true } })
    await expect(decodoSearch('key-1', 'x', { fetchImpl: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch })).rejects.toThrow('401')
  })

  it("is the host's in a hosted copy when the host offers one, the copy's own key otherwise, and none without either", async () => {
    expect(webSearcher()).toBeNull()

    process.env.WEB_SEARCH_API_KEY = 'own-key'
    const own: string[] = []
    const direct = webSearcher((async (url: string) => (own.push(url), Response.json({ results: [{ content: { results: { organic: [] } } }] }))) as unknown as typeof fetch)
    await direct!('"Acme"')
    expect(own).toEqual(['https://data.decodo.com/v1/scrape'])

    Object.assign(process.env, { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })
    // A hosted copy never uses a key of its own, and has no search until its host says so.
    expect(webSearcher()).toBeNull()
    ;(globalThis as any).__hostRules = { webSearch: true }
    const sent: Array<{ url: string; secret: string | null; body: any }> = []
    const hosted = webSearcher((async (url: string, init: RequestInit) => {
      sent.push({ url, secret: new Headers(init.headers).get('x-reacher-secret'), body: JSON.parse(String(init.body)) })
      return Response.json({ results: [{ url: 'https://acme.com/', title: 'Acme', description: '' }] })
    }) as unknown as typeof fetch)
    expect(await hosted!('"Acme" United Kingdom')).toEqual([{ url: 'https://acme.com/', title: 'Acme', description: '' }])
    expect(sent).toEqual([{ url: 'https://services.magpie.test/v1/web-search', secret: 'vt_mc_acme', body: { query: '"Acme" United Kingdom' } }])
  })
})
