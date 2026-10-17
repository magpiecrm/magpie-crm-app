import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { companyPageFromResults, domainFitsName, findCompanySite, plainName, siteFromResults, whyNoSite } from './companySite'
import { decodoSearch, webSearcher, type WebResult } from './webSearch'

const result = (url: string, title = '', description = ''): WebResult => ({ url, title, description })

describe('a company’s website from a web search', () => {
  it('is a domain that is plainly the company’s name, give or take a common ending', () => {
    const fits = (domain: string, name: string) => domainFitsName(domain, name)
    expect(fits('tinderboxresearch.com', 'Tinderbox Research')).toBe(true)
    expect(fits('nelson-hall.com', 'Nelson Hall Ltd')).toBe(true)
    expect(fits('acme.co.uk', 'Acme Consulting Limited')).toBe(true)
    expect(fits('acmeuk.com', 'Acme')).toBe(true)
    expect(fits('smithandjones.co.uk', 'Smith & Jones')).toBe(true)
    expect(fits('chalkandchilli.com', 'Chalk+Chilli')).toBe(true)
    expect(fits('research.works', 'Research Works Ltd')).toBe(true)
    expect(fits('thesocialcow.co.uk', 'The Social Cow')).toBe(true)
    // Asides, straplines and legal forms aren't part of the name.
    expect(fits('specialist-coatings.co.uk', 'Specialist Coatings (GB) Limited')).toBe(true)
    expect(fits('onefoursix.co.uk', 'onefoursix - Digital Marketing Agency')).toBe(true)
    expect(fits('planlicht.com', 'Planlicht GmbH & Co.KG')).toBe(true)
    // Not a different company that shares a word, a short scrap, or nothing at all.
    expect(fits('acmeresearchpartners.com', 'Acme')).toBe(false)
    expect(fits('research.com', 'Tinderbox Research')).toBe(false)
    expect(fits('ab.com', 'AB')).toBe(false)
    expect(fits('red.com', 'RED')).toBe(false)
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
    // The site itself, not the part of it a result was on.
    expect(siteFromResults('Nelson Hall', [result('https://reimagine.nelson-hall.com/', 'NelsonHall | Analyst research')])).toBe('nelson-hall.com')
  })

  it('takes the closest fit to the name, and a loose one only when the page names the company', () => {
    // Exactly the name beats the name with an ending, wherever each came.
    expect(siteFromResults('Blended Collective', [result('https://blendedcollectiveco.com/'), result('https://www.blendedcollective.com/')])).toBe('blendedcollective.com')
    // Part of the name could be anyone's: another Tinderbox isn't Tinderbox Research.
    expect(siteFromResults('Tinderbox Research', [result('https://tinder-box.co.uk/', 'Tinder-Box - The Performance Spark')])).toBeNull()
    expect(siteFromResults('Acme Consulting', [result('https://acme.co.uk/', 'Acme Consulting | Advice for manufacturers')])).toBe('acme.co.uk')
    expect(siteFromResults('Fineline Market Research', [result('https://www.finelinemr.co.uk/', 'Fineline Market Research')])).toBe('finelinemr.co.uk')
    expect(siteFromResults('Frozen Garden', [result('https://thefrozengarden.com/', 'Frozen Garden: Smoothie Delivery')])).toBe('thefrozengarden.com')
    expect(siteFromResults('Frozen Garden', [result('https://thefrozengarden.com/', 'Smoothie Delivery')])).toBeNull()
    // A name that starts with "The" keeps it, unless the page says it's them.
    expect(siteFromResults('The Joy Club', [result('https://www.joyclub.com/', 'JOYclub')])).toBeNull()
    expect(siteFromResults('The Property Marketing Strategists', [result('https://propertymarketingstrategists.co.uk/', 'The Property Marketing Strategists')])).toBe('propertymarketingstrategists.co.uk')
    // A one-word name is many companies': only the first two results count.
    const others = [result('https://uk.linkedin.com/company/ecomotive'), result('https://en.wikipedia.org/wiki/Ecomotive'), result('https://ecomotive.biz/')]
    expect(siteFromResults('EcoMotive', others)).toBeNull()
    expect(siteFromResults('EcoMotive', others.slice(1))).toBe('ecomotive.biz')
  })

  it('says what kind of miss a search was, without the name', () => {
    const linkedin = result('https://uk.linkedin.com/company/tinderbox-research', 'Tinderbox Research | LinkedIn')
    expect(whyNoSite('Tinderbox Research Ltd', [])).toBe('no results (2-word name, legal form, 0 results)')
    expect(whyNoSite('Tinderbox Research', [linkedin, result('https://www.yell.com/biz/tinderbox')])).toBe('only directories and social sites (2-word name, 2 results, its LinkedIn page among them)')
    expect(whyNoSite('Tinderbox Research', [result('https://tinder-box.co.uk/', 'Tinder-Box - The Performance Spark')])).toBe("a near fit the page didn't name (2-word name, 1 results)")
    expect(whyNoSite('EcoMotive', [linkedin, result('https://en.wikipedia.org/wiki/Ecomotive'), result('https://ecomotive.biz/')])).toBe('a fit below the first two results (1-word name, 3 results)')
    expect(whyNoSite('PINCH Insight & Strategy', [result('https://wearepinch.com/', 'PINCH Insight & Strategy | Research agency')])).toBe('a page that names it, on a domain unlike its name (3-word name, 1 results)')
    expect(whyNoSite('Nowhere Much', [result('https://www.theguardian.com/somewhere', 'Somewhere else entirely')])).toBe('no site fits the name (2-word name, 1 results)')
  })

  it('reads the website off a LinkedIn page the search turns up, when no result is the site itself', async () => {
    const linkedin = result('https://uk.linkedin.com/company/tbx-research-uk?trk=x', 'Tinderbox Research | LinkedIn')
    expect(companyPageFromResults('Tinderbox Research Ltd', [result('https://www.yell.com/biz/1'), linkedin])).toBe('tbx-research-uk')
    // Not someone's profile, and not another company's page.
    expect(companyPageFromResults('Tinderbox Research', [result('https://uk.linkedin.com/in/jane', 'Jane - Tinderbox Research'), result('https://www.linkedin.com/company/tinderbox', 'Tinderbox Business Development')])).toBeNull()

    const kept = new Map<string, { domain: string | null; at: string }>()
    const db = { getCompanySite: (k: string) => kept.get(k) ?? null, setCompanySite: (k: string, domain: string | null) => void kept.set(k, { domain, at: new Date().toISOString() }) }
    const read: string[] = []
    const page = async (pageName: string) => (read.push(pageName), 'tbxresearch.co.uk')
    expect(await findCompanySite('Tinderbox Research', 'United Kingdom', async () => [linkedin], db, Date.now(), page)).toBe('tbxresearch.co.uk')
    expect(kept.get('tinderbox research')?.domain).toBe('tbxresearch.co.uk')
    // The site itself among the results is taken first, and the page left alone.
    expect(await findCompanySite('Acme Widgets', null, async () => [result('https://www.linkedin.com/company/acme-w', 'Acme Widgets'), result('https://acmewidgets.com/')], db, Date.now(), page)).toBe('acmewidgets.com')
    expect(read).toEqual(['tbx-research-uk'])
    // A page that isn't theirs, or lists no website, is a miss like any other; one that couldn't be read is asked about again.
    expect(await findCompanySite('Nowhere Much', null, async () => [result('https://www.linkedin.com/company/nm', 'Nowhere Much')], db, Date.now(), async () => null)).toBeNull()
    expect(kept.get('nowhere much')).toMatchObject({ domain: null })
    // Couldn't be read: nothing learned (undefined, not null), so it isn't taken as having no website.
    expect(await findCompanySite('Elsewhere Much', null, async () => [result('https://www.linkedin.com/company/em', 'Elsewhere Much')], db, Date.now(), async () => Promise.reject(new Error('not read')))).toBeUndefined()
    expect(kept.has('elsewhere much')).toBe(false)
  })

  it('searches for the name by itself', () => {
    expect(plainName('Research Works Ltd')).toBe('Research Works')
    expect(plainName('IT GuidePoint Corporation (itguidepoint.com)')).toBe('IT GuidePoint')
    expect(plainName('Brookstone Creative Ltd - Industrial Marketing Services')).toBe('Brookstone Creative')
    expect(plainName('Builderfriend | Social Media Management')).toBe('Builderfriend')
    expect(plainName('Next Level Careers, LLC')).toBe('Next Level Careers')
    expect(plainName('Smith & Jones')).toBe('Smith & Jones')
    // Nothing left to search for: the name as it was.
    expect(plainName('Co. Ltd')).toBe('Co. Ltd')
  })

  it('is searched for once per company, by its name and country only, and remembered either way', async () => {
    const kept = new Map<string, { domain: string | null; at: string }>()
    const db = { getCompanySite: (k: string) => kept.get(k) ?? null, setCompanySite: (k: string, domain: string | null) => void kept.set(k, { domain, at: new Date().toISOString() }) }
    const asked: Array<[string, string | null | undefined]> = []
    const search = async (query: string, country?: string | null) => (asked.push([query, country]), query.includes('Tinderbox') ? [result('https://tinderboxresearch.com/')] : [])
    const [a, b] = await Promise.all([findCompanySite('Tinderbox Research Ltd', 'United Kingdom', search, db), findCompanySite('Tinderbox Research', 'United Kingdom', search, db)])
    expect([a, b]).toEqual(['tinderboxresearch.com', 'tinderboxresearch.com'])
    expect(await findCompanySite('Nowhere Much', null, search, db)).toBeNull()
    expect(await findCompanySite('Nowhere Much', null, search, db)).toBeNull()
    // The name alone, searched from the company's country.
    expect(asked).toEqual([['Tinderbox Research', 'United Kingdom'], ['Nowhere Much', null]])
    // Nothing found is asked about again after a month; a search that failed, next time.
    expect(await findCompanySite('Nowhere Much', null, search, db, Date.now() + 31 * 86_400_000)).toBeNull()
    expect(asked).toHaveLength(3)
    expect(await findCompanySite('Broken Search Co', null, async () => Promise.reject(new Error('down')), db)).toBeUndefined()
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
    // A LinkedIn page the search turns up is read for the website, if it goes by the same name.
    forgetCompanyGuesses()
    const asked: string[] = []
    const pages = {
      ...noPages,
      getCompany: async (ref: string) => (asked.push(ref), ref === 'tbx-uk' ? { ref: '991', name: 'Tinderbox Research Ltd', domain: 'tbxresearch.co.uk', headcount: 4 } : null),
    } as any
    const turnsUp = (title: string) => async () => [result('https://uk.linkedin.com/company/tbx-uk', title)]
    expect(await domainForPerson(person, pages, store(), turnsUp('Tinderbox Research | LinkedIn'))).toBe('tbxresearch.co.uk')
    expect(asked).toEqual(['tinderbox-research', 'tbx-uk'])
    forgetCompanyGuesses()
    expect(await domainForPerson({ ...person, company: 'Tinderbox Researchers' }, pages, store(), turnsUp('Tinderbox Researchers | LinkedIn'))).toBeNull()
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
    // Searched from the company's country when it's one we know.
    await decodoSearch('key-1', 'Acme', { fetchImpl: answer({ results: { organic } }), country: 'uk' })
    await decodoSearch('key-1', 'Acme', { fetchImpl: answer({ results: { organic } }), country: 'Exeter' })
    expect(calls.slice(2).map((c) => c.body.geo)).toEqual(['United Kingdom', undefined])
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
    expect(await hosted!('Acme', 'United Kingdom')).toEqual([{ url: 'https://acme.com/', title: 'Acme', description: '' }])
    expect(sent).toEqual([{ url: 'https://services.magpie.test/v1/web-search', secret: 'vt_mc_acme', body: { query: 'Acme', country: 'United Kingdom' } }])
  })
})
