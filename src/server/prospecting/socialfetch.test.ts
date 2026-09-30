import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalProfileUrl, createSocialFetchSource, domainFromWebsite, mapPerson, meterCredits, sameCompanyName, titleFromHeadline, titleMatcher } from './socialfetch'

// No network: every test drives the connector through a fake fetch that
// records requests and replays canned SocialFetch envelopes.

function envelope(data: unknown, credits = 3) {
  return new Response(JSON.stringify({ data, meta: { requestId: 'req_test', creditsCharged: credits } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(responses: Array<Response | (() => Response)>) {
  const calls: URL[] = []
  const headers: Array<Record<string, string>> = []
  const impl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push(new URL(String(url)))
    headers.push((init?.headers ?? {}) as Record<string, string>)
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return typeof next === 'function' ? next() : next
  })
  return { impl: impl as unknown as typeof fetch, calls, headers }
}

const rawPerson = (over: Record<string, unknown> = {}) => ({
  sourceFamily: 'live',
  handle: 'jane-smith-123',
  profileUrl: 'https://www.linkedin.com/in/Jane-Smith-123/',
  firstName: 'Jane',
  lastName: 'Smith',
  headline: 'Helping teams ship',
  summary: 'Long bio that must not survive mapping',
  profilePictureUrl: 'https://cdn.example/jane.jpg',
  followerCount: 5400,
  geoCity: 'Manchester',
  geo: { city: 'Manchester', country: 'United Kingdom', countryCode: 'GB' },
  education: [{ school: 'Somewhere' }],
  skills: ['a', 'b'],
  currentPositions: [{ title: 'Head of Marketing', organizationName: 'Acme Ltd', organizationId: '1234', isCurrent: true }],
  ...over,
})

beforeEach(() => {
  process.env.SOCIALFETCH_API_KEY = 'sfk_test'
})
afterEach(() => {
  delete process.env.SOCIALFETCH_API_KEY
})

describe('titleMatcher', () => {
  it('finds the title in any part of a headline, before "at <company>", in any word order', () => {
    const fits = titleMatcher('Sales Manager')
    expect(['Regional Sales Manager', 'Sales & Account Manager at Acme', 'Helping teams | Sales Manager at X', 'Manager, Sales'].map(fits)).toEqual([true, true, true, true])
    expect(['Key Account Manager', 'Manager at Salesforce', 'Partner', '', null].map(fits)).toEqual([false, false, false, false, false])
  })

  it('treats a title and its usual abbreviation as the same, and short words as whole words', () => {
    expect(['CFO - Siena Partnership', 'Chief Financial Officer', 'Interim CFO | Advisor'].map(titleMatcher('CFO'))).toEqual([true, true, true])
    expect(titleMatcher('CFO')('Helping CFOs scale')).toBe(false)
    expect(titleMatcher('Chief Financial Officer')('CFO at Acme')).toBe(true)
    expect(titleMatcher('VP Sales')('Vice President, Sales EMEA')).toBe(true)
    expect(titleMatcher('Head of Sales')('Head of Presales')).toBe(false)
  })
})

describe('mapping', () => {
  it('keeps only the allowed person fields', () => {
    const person = mapPerson(rawPerson())
    expect(person).toEqual({
      profileUrl: 'https://www.linkedin.com/in/jane-smith-123',
      firstName: 'Jane',
      lastName: 'Smith',
      title: 'Head of Marketing',
      seniority: 'head',
      company: 'Acme Ltd',
      companyRef: '1234',
      companySlug: null,
      companyDomain: null,
      country: 'United Kingdom',
      source: 'socialfetch',
    })
    const serialised = JSON.stringify(person)
    for (const dropped of ['Manchester', 'cdn.example', '5400', 'Long bio', 'Somewhere']) {
      expect(serialised).not.toContain(dropped)
    }
  })

  it('falls back to the headline and full name', () => {
    const person = mapPerson({ handle: 'x', fullName: 'Ana María López', headline: 'CTO at Foo', currentPositions: [] })
    expect(person).toMatchObject({ firstName: 'Ana', lastName: 'María López', title: 'CTO', company: 'Foo', seniority: 'c_suite' })
  })

  it('reads numeric organisation ids, and falls back to the company page slug', () => {
    const numeric = mapPerson(rawPerson({ currentPositions: [{ title: 'CFO', organizationName: 'Acme', organizationId: 12345, isCurrent: true }] }))
    expect(numeric?.companyRef).toBe('12345')
    const slugOnly = mapPerson(
      rawPerson({ currentPositions: [{ title: 'CFO', organizationName: 'Acme', organizationUrl: 'https://www.linkedin.com/company/acme-ltd/', isCurrent: true }] }),
    )
    expect(slugOnly?.companyRef).toBe('acme-ltd')
    const noPage = mapPerson(rawPerson({ currentPositions: [{ title: 'Freelance Consultant', organizationName: 'Self-employed', isCurrent: true }] }))
    expect(noPage).toMatchObject({ company: 'Self-employed', companyRef: null })
    // The page name is kept alongside the id, for the cheaper company lookup.
    const both = mapPerson(
      rawPerson({ currentPositions: [{ title: 'CFO', organizationName: 'Acme', organizationId: 12345, organizationUrl: 'https://www.linkedin.com/company/acme-ltd/', isCurrent: true }] }),
    )
    expect(both).toMatchObject({ companyRef: '12345', companySlug: 'acme-ltd' })
  })

  it('treats organization id 0 as no company page, falling back to the page name', () => {
    // LinkedIn sends 0 for a job with no company page; it isn't organization 0.
    for (const organizationId of [0, '0']) {
      const zero = mapPerson(rawPerson({ currentPositions: [{ title: 'CFO', organizationName: 'Acme', organizationId, isCurrent: true }] }))
      expect(zero?.companyRef).toBeNull()
    }
    const withPage = mapPerson(
      rawPerson({ currentPositions: [{ title: 'CFO', organizationName: 'Acme', organizationId: 0, organizationUrl: 'https://www.linkedin.com/company/acme-ltd/', isCurrent: true }] }),
    )
    expect(withPage).toMatchObject({ companyRef: 'acme-ltd', companySlug: 'acme-ltd' })
  })

  it('rejects records with no profile URL or name', () => {
    expect(mapPerson({ firstName: 'No', lastName: 'Url' })).toBeNull()
    expect(mapPerson({ handle: 'nameless' })).toBeNull()
  })

  it('normalises websites to a mail domain', () => {
    expect(domainFromWebsite('https://www.Acme.co.uk/about')).toBe('acme.co.uk')
    expect(domainFromWebsite('acme.io')).toBe('acme.io')
    expect(domainFromWebsite('https://linkedin.com/company/acme')).toBeNull()
    expect(domainFromWebsite('')).toBeNull()
  })

  it('canonicalises profile URLs', () => {
    expect(canonicalProfileUrl('https://uk.linkedin.com/in/Jane-S?trk=x')).toBe('https://www.linkedin.com/in/jane-s')
    expect(canonicalProfileUrl(undefined, 'jane')).toBe('https://www.linkedin.com/in/jane')
  })

  it('cleans a job title out of a headline', () => {
    expect(titleFromHeadline('Senior Business Analyst at Barclays | Agile')).toBe('Senior Business Analyst')
    expect(titleFromHeadline('Head of Data @ Monzo')).toBe('Head of Data')
    expect(titleFromHeadline('Product Manager | Fintech • Payments')).toBe('Product Manager')
    expect(titleFromHeadline('Helping teams ship faster')).toBe('Helping teams ship faster')
    // "at" inside a word is not a separator.
    expect(titleFromHeadline('Data Analyst')).toBe('Data Analyst')
    expect(titleFromHeadline(null)).toBeNull()
  })

  it('compares company names loosely', () => {
    expect(sameCompanyName('Acme Ltd', 'ACME')).toBe(true)
    expect(sameCompanyName('The Acme Group', 'Acme')).toBe(true)
    expect(sameCompanyName('Acme', 'Acmeology')).toBe(false)
  })
})

describe('searchCompanies', () => {
  const orgs = [
    { liveOrganizationId: '1', name: 'Acme', website: 'https://acme.com', industry: 'Software Development', staffCount: 120, headquarter: { country: 'United Kingdom' } },
    { liveOrganizationId: '2', name: 'Acme UK', website: 'https://www.acme.com', industry: 'Software Development', staffCount: 40, headquarter: { country: 'United Kingdom' } },
    { liveOrganizationId: '3', name: 'Other', website: 'https://other.io', industry: 'Retail', staffCount: 9000, headquarter: { country: 'France' } },
    { liveOrganizationId: '4', name: 'No Site', industry: 'Software Development', staffCountRange: '51-200', headquarter: { country: 'United Kingdom' } },
  ]

  it('sends the key, keyword and filters, dedupes by domain, and checks an industry it could not send', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', organizations: orgs, page: { hasMore: true, nextCursor: 'c2' }, reportedTotal: 812 })])
    const page = await createSocialFetchSource(f.impl).searchCompanies({ keyword: 'acme', industry: 'software', headcount: ['51-200'], country: 'united kingdom' })

    expect(f.calls[0].pathname).toBe('/v2/linkedin/organizations/search')
    expect(f.calls[0].searchParams.get('keyword')).toBe('acme')
    expect(f.calls[0].searchParams.get('headcountRange')).toBe('51-200')
    // "software" isn't one of LinkedIn's industry names, so it's checked on each result instead.
    expect(f.calls[0].searchParams.has('industry')).toBe(false)
    expect(f.headers[0]['x-api-key']).toBe('sfk_test')
    expect(page.items.map((c) => c.name)).toEqual(['Acme', 'No Site'])
    expect(page.items[1].domain).toBeNull()
    // Carries on by offset, never with SocialFetch's own cursor.
    expect(page.nextCursor).toBe('start:4')
    expect(page.reportedTotal).toBe(812)
    expect(page.details![0]).toMatch(/1 of 4 companies/)
  })

  // SocialFetch's cursor names the filters it was made with, and one saved
  // from before its release on 2026-09-30 was refused ("Pagination cursor
  // does not match this request").
  it('asks for the next page by offset, reading the offset out of a SocialFetch cursor saved from before', async () => {
    const f = fakeFetch([
      envelope({ lookupStatus: 'found', organizations: orgs, page: { hasMore: true } }),
      envelope({ lookupStatus: 'found', organizations: orgs, page: { hasMore: false } }),
    ])
    const source = createSocialFetchSource(f.impl)
    await source.searchCompanies({ keyword: 'acme', cursor: 'start:25' })
    expect(f.calls[0].searchParams.get('start')).toBe('25')
    expect(f.calls[0].searchParams.has('cursor')).toBe(false)
    const old = Buffer.from(JSON.stringify({ v: 1, operation: 'live.search.organizations', next: { start: 50 } })).toString('base64url')
    await source.searchCompanies({ keyword: 'acme', cursor: old })
    expect(f.calls[1].searchParams.get('start')).toBe('50')
    expect(f.calls[1].searchParams.has('cursor')).toBe(false)
  })
})

describe('searchPeople', () => {
  // Shape observed from the live API on 2026-09-25: search hits carry only
  // these fields (no positions, employer or structured country).
  const searchHit = (handle: string, first: string, last: string, headline: string, location: string) => ({
    sourceFamily: 'live',
    liveNumericId: '1',
    entityId: 'ACoAA',
    profileUrl: `https://www.linkedin.com/in/${handle}`,
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`,
    headline,
    isPremium: false,
    location,
  })

  it('sends the title as the title filter (words joined by underscores) and the keyword apart, asking for 50 whatever the page size', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', people: [searchHit('a', 'A', 'One', 'Business Analyst', 'London')], page: { hasMore: false } })])
    await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['Business Analyst'], keyword: 'fintech', count: 5 })
    expect(f.calls[0].searchParams.get('title')).toBe('Business_Analyst')
    expect(f.calls[0].searchParams.get('keyword')).toBe('fintech')
    // A request costs 3 credits whatever it returns; the people not used are held.
    expect(f.calls[0].searchParams.get('count')).toBe('50')
    expect(f.calls[0].searchParams.has('currentCompany')).toBe(false)
  })

  it('maps real search hits: title and employer from the headline, country from the location label', async () => {
    const f = fakeFetch([
      envelope({
        lookupStatus: 'found',
        people: [
          searchHit('ana-b', 'Ana', 'Byrne', 'Senior Business Analyst at Barclays | Agile', 'Leeds, England, United Kingdom'),
          searchHit('raj-k', 'Raj', 'Kumar', 'Business Analyst', 'New York, New York, United States'),
        ],
        page: { kind: 'offset', hasMore: false },
      }),
    ])
    const page = await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['Business Analyst'] })
    expect(page.items[0]).toEqual({
      profileUrl: 'https://www.linkedin.com/in/ana-b',
      firstName: 'Ana',
      lastName: 'Byrne',
      title: 'Senior Business Analyst',
      seniority: 'senior',
      company: 'Barclays',
      companyRef: null,
      companySlug: null,
      companyDomain: null,
      country: 'United Kingdom',
      source: 'socialfetch',
    })
    // City-level location is not kept anywhere on the result.
    expect(JSON.stringify(page.items)).not.toContain('Leeds')
    expect(page.items[1]).toMatchObject({ company: '', country: 'United States' })
  })

  it('lets SocialFetch filter supported countries by geo id, and fills in the country for city-only labels', async () => {
    const f = fakeFetch([
      envelope({
        people: [
          searchHit('a', 'A', 'One', 'Business Analyst', 'Glasgow, Scotland'),
          searchHit('b', 'B', 'Two', 'Business Analyst', 'Exeter'),
          searchHit('c', 'C', 'Three', 'Business Analyst', 'United Kingdom'),
        ],
        page: { kind: 'offset', hasMore: false },
      }),
    ])
    const page = await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['Business Analyst'], country: 'UK' })
    expect(f.calls[0].searchParams.get('geoEntityId')).toBe('101165590')
    expect(page.items.map((p) => [p.firstName, p.country])).toEqual([
      ['A', 'United Kingdom'],
      ['B', 'United Kingdom'],
      ['C', 'United Kingdom'],
    ])
    expect(page.warnings).toEqual([])
  })

  it('warns when geo-filtered results come back mostly from another country', async () => {
    const hits = Array.from({ length: 6 }, (_, i) => searchHit(`p${i}`, `P${i}`, 'X', 'BA', 'Paris, Île-de-France, France'))
    const f = fakeFetch([envelope({ people: hits, page: { hasMore: false } })])
    const page = await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['BA'], country: 'Germany' })
    expect(f.calls[0].searchParams.get('geoEntityId')).toBe('101282230')
    expect(page.details!.some((w) => /aren't in Germany/.test(w))).toBe(true)
  })

  it('falls back to filtering each page for countries without a geo id', async () => {
    const f = fakeFetch([
      envelope({
        people: [
          searchHit('a', 'A', 'One', 'BA', 'Lisbon, Portugal'),
          searchHit('b', 'B', 'Two', 'BA', 'Madrid, Spain'),
        ],
        page: { hasMore: false },
      }),
    ])
    const page = await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['BA'], country: 'Portugal' })
    expect(f.calls[0].searchParams.has('geoEntityId')).toBe(false)
    expect(page.items.map((p) => p.firstName)).toEqual(['A'])
    expect(page.details!.some((w) => /isn't in the supported country list/.test(w))).toBe(true)
  })

  it('pages by offset, carrying on from where SocialFetch says the page ended', async () => {
    const f = fakeFetch([
      envelope({ people: [searchHit('p1', 'P', 'One', 'BA', 'London')], page: { kind: 'offset', hasMore: true, start: 0, returnedCount: 25 } }),
      envelope({ people: [searchHit('p2', 'P', 'Two', 'BA', 'London')], page: { kind: 'offset', hasMore: false, start: 25, returnedCount: 1 } }),
    ])
    const source = createSocialFetchSource(f.impl)
    const first = await source.searchPeople(null, { titles: ['BA'] })
    expect(first.nextCursor).not.toBeNull()
    const second = await source.searchPeople(null, { titles: ['BA'], cursor: first.nextCursor! })
    expect(f.calls[1].searchParams.get('start')).toBe('25')
    expect(f.calls[1].searchParams.has('cursor')).toBe(false)
    expect(second.items[0].lastName).toBe('Two')
    expect(second.nextCursor).toBeNull()
  })

  it('carries on a SocialFetch cursor from an older search by the offset inside it', async () => {
    const f = fakeFetch([envelope({ people: [searchHit('p2', 'P', 'Two', 'BA', 'London')], page: { hasMore: false } })])
    const theirs = Buffer.from(JSON.stringify({ v: 1, next: { start: 30 } })).toString('base64url')
    const cursor = Buffer.from(JSON.stringify({ BA: `c5:${theirs}` })).toString('base64url')
    await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['BA'], count: 2, cursor })
    expect(f.calls[0].searchParams.get('start')).toBe('30')
    expect(f.calls[0].searchParams.has('cursor')).toBe(false)
  })

  it('tries a multi-word title the other way once if it finds nobody, and keeps whichever works', async () => {
    const hit = searchHit('a', 'A', 'One', 'Head of Sales', 'London')
    const f = fakeFetch([
      envelope({ people: [], page: { hasMore: false } }),
      envelope({ people: [hit], page: { hasMore: false } }),
      envelope({ people: [], page: { hasMore: false } }),
    ])
    const source = createSocialFetchSource(f.impl)
    const page = await source.searchPeople(null, { titles: ['Head of Sales'] })
    expect(f.calls.map((c) => c.searchParams.get('title'))).toEqual(['Head_of_Sales', 'Head of Sales'])
    expect(page.items).toHaveLength(1)
    expect(page.requests).toBe(2)
    // Spaces worked, so they're used from now on, and an empty result isn't retried.
    await source.searchPeople(null, { titles: ['Sales Manager'] })
    expect(f.calls[2].searchParams.get('title')).toBe('Sales Manager')
    expect(f.calls).toHaveLength(3)
  })

  // Inside a few small companies, people search returns everyone there,
  // whatever their job (seen on a live search for Sales Manager, 2026-09-29).
  it("leaves out people whose headline doesn't name the title searched for, before any profile is paid for", async () => {
    const f = fakeFetch([
      envelope({
        people: [
          searchHit('a', 'A', 'One', 'Regional Sales Manager at Acme', 'London'),
          searchHit('b', 'B', 'Two', 'Key Account Manager - Futurelink', 'London'),
          searchHit('c', 'C', 'Three', 'Partner', 'London'),
          searchHit('d', 'D', 'Four', 'Helping teams grow | Sales & Account Manager', 'London'),
        ],
        page: { kind: 'offset', hasMore: false, start: 0, returnedCount: 4 },
      }),
    ])
    const page = await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['Sales Manager'], companyRefs: ['1', '2'] })
    expect(page.items.map((p) => p.firstName)).toEqual(['A', 'D'])
    expect(page.details).toContain("2 people returned by the search don't have the job title in their headline and were left out, before any profile was paid for.")
  })

  describe('holds the people a page does not use', () => {
    const fifty = () =>
      envelope({
        people: Array.from({ length: 50 }, (_, i) => searchHit(`p${i}`, `P${i}`, 'X', 'BA', 'London')),
        page: { kind: 'offset', hasMore: true, start: 0, returnedCount: 50 },
      })

    it('serves the next page and top-ups from them without another request, then carries on after them', async () => {
      const f = fakeFetch([fifty(), envelope({ people: [searchHit('q', 'Q', 'X', 'BA', 'London')], page: { kind: 'offset', hasMore: false, start: 50, returnedCount: 1 } })])
      const source = createSocialFetchSource(f.impl)
      const first = await source.searchPeople(null, { titles: ['BA'], count: 25 })
      expect(first.items.map((p) => p.firstName)).toEqual(Array.from({ length: 25 }, (_, i) => `P${i}`))
      expect(first.requests).toBe(1)

      // A top-up of 3, then the rest of the page: no request.
      const topUp = await source.searchPeople(null, { titles: ['BA'], count: 3, cursor: first.nextCursor! })
      expect(topUp.items.map((p) => p.firstName)).toEqual(['P25', 'P26', 'P27'])
      expect(topUp.requests).toBe(0)
      const rest = await source.searchPeople(null, { titles: ['BA'], count: 25, cursor: topUp.nextCursor! })
      expect(rest.items).toHaveLength(22)
      expect(rest.items[0].firstName).toBe('P28')
      expect(f.calls).toHaveLength(1)

      // Once they're used up, SocialFetch is asked again from where they ended.
      const next = await source.searchPeople(null, { titles: ['BA'], count: 25, cursor: rest.nextCursor! })
      expect(f.calls).toHaveLength(2)
      expect(f.calls[1].searchParams.get('start')).toBe('50')
      expect(next.items.map((p) => p.firstName)).toEqual(['Q'])
      expect(next.nextCursor).toBeNull()
    })

    it('asks again from the same place when they are no longer held (a restart), skipping nobody', async () => {
      const f = fakeFetch([fifty(), envelope({ people: [], page: { kind: 'offset', hasMore: false, start: 25, returnedCount: 0 } })])
      const first = await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['BA'], count: 25 })
      // A new source has an empty pool, as after a restart.
      await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['BA'], count: 25, cursor: first.nextCursor! })
      expect(f.calls[1].searchParams.get('start')).toBe('25')
    })

    it("doesn't serve them to a search with different filters", async () => {
      const f = fakeFetch([fifty(), envelope({ people: [], page: { hasMore: false } })])
      const source = createSocialFetchSource(f.impl)
      await source.searchPeople(null, { titles: ['BA'], count: 25 })
      await source.searchPeople(null, { titles: ['BA'], count: 25, country: 'UK' })
      expect(f.calls).toHaveLength(2)
    })
  })

  it('with a chosen company, searches by its id and only ties people to it when their headline names it', async () => {
    const f = fakeFetch([
      envelope({
        people: [
          searchHit('in', 'In', 'Side', 'Business Analyst at Acme', 'London'),
          searchHit('out', 'Out', 'Side', 'Business Analyst at Globex', 'London'),
          searchHit('unk', 'Un', 'Known', 'Business Analyst', 'London'),
        ],
        page: { hasMore: false },
      }),
    ])
    const page = await createSocialFetchSource(f.impl).searchPeople({ ref: '1234', name: 'Acme' }, { titles: ['Business Analyst'] })
    expect(f.calls[0].searchParams.get('title')).toBe('Business_Analyst')
    expect(f.calls[0].searchParams.has('keyword')).toBe(false)
    expect(f.calls[0].searchParams.get('currentCompany')).toBe('1234')
    expect(page.items.map((p) => [p.firstName, p.companyRef])).toEqual([
      ['In', '1234'],
      // Employer unknown: kept, but not assumed to be Acme (resolved on save).
      ['Un', null],
    ])
    expect(page.details).toContain("1 person returned by the search doesn't currently work at Acme and was hidden.")
  })

  it('runs one request per title and dedupes people across them', async () => {
    const f = fakeFetch([
      envelope({ people: [rawPerson({ headline: 'CMO | Head of Marketing' })], page: { hasMore: true, nextCursor: 'cmo-2' } }),
      envelope({ people: [rawPerson({ headline: 'CMO | Head of Marketing' })], page: { hasMore: false } }),
      envelope({ people: [rawPerson({ handle: 'p2', profileUrl: 'https://www.linkedin.com/in/p2', firstName: 'Pat', headline: 'Interim CMO' })], page: { hasMore: false } }),
    ])
    const source = createSocialFetchSource(f.impl)
    const first = await source.searchPeople(null, { titles: ['CMO', 'Head of Marketing'] })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).not.toBeNull()

    const second = await source.searchPeople(null, { titles: ['CMO', 'Head of Marketing'], cursor: first.nextCursor! })
    // Only the title with pages left is re-queried, from its own place.
    expect(f.calls).toHaveLength(3)
    expect(f.calls[2].searchParams.get('title')).toBe('CMO')
    expect(f.calls[2].searchParams.get('start')).toBe('1')
    expect(second.items[0].firstName).toBe('Pat')
    expect(second.nextCursor).toBeNull()
  })

  it('filters by seniority derived from the title', async () => {
    const f = fakeFetch([
      envelope({
        people: [
          rawPerson(),
          rawPerson({ handle: 'e', profileUrl: 'https://www.linkedin.com/in/e', currentPositions: [{ title: 'Junior Analyst', organizationName: 'Acme Ltd' }] }),
          rawPerson({ handle: 'f', profileUrl: 'https://www.linkedin.com/in/f', geo: { country: 'France' } }),
        ],
        page: { hasMore: false },
      }),
    ])
    const page = await createSocialFetchSource(f.impl).searchPeople(null, { seniorities: ['head'] })
    // The junior analyst is hidden; both Heads of Marketing stay.
    expect(page.items.map((p) => p.profileUrl)).toEqual(['https://www.linkedin.com/in/jane-smith-123', 'https://www.linkedin.com/in/f'])
    expect(page.details).toContain("1 person didn't match your seniority or country filters and is hidden.")
  })
})

describe('errors and retries', () => {
  it('retries 503 honouring Retry-After, then succeeds', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeFetch([
        new Response('{"error":{"message":"busy"}}', { status: 503, headers: { 'retry-after': '1' } }),
        envelope({ organizations: [], page: { hasMore: false } }),
      ])
      const promise = createSocialFetchSource(f.impl).searchCompanies({ keyword: 'x' })
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(promise).resolves.toMatchObject({ items: [] })
      expect(f.calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry 402 and explains it', async () => {
    const f = fakeFetch([new Response('{"error":{"message":"insufficient credits"}}', { status: 402 })])
    await expect(createSocialFetchSource(f.impl).searchCompanies({ keyword: 'x' })).rejects.toMatchObject({ code: 'credits_exhausted' })
    expect(f.calls).toHaveLength(1)
  })

  it('reports a bad key clearly', async () => {
    const f = fakeFetch([new Response('{}', { status: 401 })])
    await expect(createSocialFetchSource(f.impl).searchCompanies({ keyword: 'x' })).rejects.toThrow(/Settings → Data source/)
  })

  it('treats not_found lookups as null', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'not_found', organization: null })])
    expect(await createSocialFetchSource(f.impl).getCompany('999')).toBeNull()
    expect(f.calls[0].searchParams.get('id')).toBe('999')
  })

  // The 1-credit company page, by URL, when the page name is known.
  const companyPage = () => envelope({
    lookupStatus: 'found',
    company: { id: '4777', name: 'NatWest', website: 'http://www.natwest.com', employeeRange: '10,001+ employees', industry: 'Banking' },
    metrics: { employees: 7048 },
  })

  it('uses the 1-credit company page when the page name is known', async () => {
    const f = fakeFetch([companyPage()])
    expect(await createSocialFetchSource(f.impl).getCompany('4777', 'natwest')).toMatchObject({
      ref: '4777',
      name: 'NatWest',
      domain: 'natwest.com',
      headcount: 7048,
      industry: 'Banking',
    })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].pathname).toBe('/v1/linkedin/companies')
    expect(f.calls[0].searchParams.get('url')).toBe('https://www.linkedin.com/company/natwest/')
  })

  it('uses the company page for a slug ref too, instead of the 9-credit slug lookup', async () => {
    const f = fakeFetch([companyPage()])
    expect(await createSocialFetchSource(f.impl).getCompany('natwest')).toMatchObject({ domain: 'natwest.com' })
    expect(f.calls.map((c) => c.pathname)).toEqual(['/v1/linkedin/companies'])
  })

  it('falls back to the organization lookup when the company page fails or is not a company', async () => {
    const f = fakeFetch([
      new Response('{"error":{"message":"bad url"}}', { status: 400 }),
      envelope({ lookupStatus: 'found', organization: { liveOrganizationId: '5', name: 'Beta', website: 'beta.dev' } }),
    ])
    expect(await createSocialFetchSource(f.impl).getCompany('5', 'beta-inc')).toMatchObject({ ref: '5', domain: 'beta.dev' })
    expect(f.calls.map((c) => c.pathname)).toEqual(['/v1/linkedin/companies', '/v2/linkedin/organizations'])
    expect(f.calls[1].searchParams.get('id')).toBe('5')
  })

  it('only uses the organization lookup (by id) when there is no page name', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', organization: { liveOrganizationId: '5', name: 'Beta', website: 'beta.dev' } })])
    await createSocialFetchSource(f.impl).getCompany('5')
    expect(f.calls.map((c) => c.pathname)).toEqual(['/v2/linkedin/organizations'])
  })

  it("doesn't fall back when out of credits", async () => {
    const f = fakeFetch([new Response('{"error":{"message":"insufficient credits"}}', { status: 402 })])
    await expect(createSocialFetchSource(f.impl).getCompany('5', 'beta-inc')).rejects.toMatchObject({ code: 'credits_exhausted' })
    expect(f.calls).toHaveLength(1)
  })
})

describe('errors in a workspace whose data is run by its host', () => {
  it("never names the provider or points at settings the user can't see", async () => {
    process.env.PROSPECTING_MANAGED = 'on'
    try {
      const messages: string[] = []
      // (429/500/502/503 are retried first; their final wording is the same path.)
      for (const status of [401, 402, 400, 504]) {
        const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status })) as unknown as typeof fetch
        const src = createSocialFetchSource(fetchImpl, () => 'sfk_test')
        messages.push(await src.getPerson('https://www.linkedin.com/in/x').then(() => '', (e: Error) => e.message))
      }
      expect(messages).toEqual([
        "Search isn't available for this workspace right now. Contact support if it continues.",
        'This workspace has used its search allowance for this billing period.',
        "The search couldn't run: nope",
        'Search failed (error 504). Try again shortly.',
      ])
      expect(messages.join(' ')).not.toMatch(/SocialFetch|Settings|Top up/)
    } finally {
      delete process.env.PROSPECTING_MANAGED
    }
  })
})

describe('mapPerson with a current job that only names the employer', () => {
  it('takes the title from the same job in the full position list, not the headline', () => {
    const person = mapPerson({
      handle: 'nd',
      firstName: 'Nelson',
      lastName: 'D',
      headline: 'I help developers get hired, from first job to senior engineer',
      currentPositions: [{ title: null, organizationName: 'Amigoscode', isCurrent: null }],
      positions: [
        { title: 'Founder', organizationName: 'Amigoscode', isCurrent: null },
        { title: 'Lead Trainer', organizationName: 'Bright Network', isCurrent: null },
      ],
    })!
    expect([person.title, person.company, person.seniority]).toEqual(['Founder', 'Amigoscode', 'founder'])
  })

  it("takes the company's page name from the same job when the current one only has its id", () => {
    const person = mapPerson({
      handle: 'x', firstName: 'A', lastName: 'B', headline: 'Head of Marketing',
      currentPositions: [{ title: 'Head of Marketing', organization: { id: '630969' }, organizationName: 'Motion Software' }],
      positions: [{ title: 'Head of Marketing', organizationId: '630969', organizationHandle: 'motion-software', organizationName: 'Motion Software' }],
    })!
    expect([person.companyRef, person.companySlug]).toEqual(['630969', 'motion-software'])
  })

  it('never takes a title from a different employer', () => {
    const person = mapPerson({
      handle: 'x', firstName: 'A', lastName: 'B', headline: 'Consultant | Speaker',
      currentPositions: [{ title: null, organizationName: 'Acme' }],
      positions: [{ title: 'Design Manager', organizationName: 'BAM Construct UK' }],
    })!
    expect(person.title).toBe('Consultant')
  })
})

describe('searchPeople by industry, and company search filters', () => {
  const orgs = (ids: string[], page: Record<string, unknown>) =>
    envelope({ lookupStatus: 'found', organizations: ids.map((id) => ({ liveOrganizationId: id, name: `Co ${id}` })), page })

  it("sends the industries as LinkedIn's codes", async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', people: [], page: { hasMore: false } })])
    await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['Marketing'], industries: ['Software Development', 'Financial Services', 'Not an industry'] })
    expect(f.calls[0].searchParams.get('industry')).toBe('4,43')
  })

  it('searches a chosen company by its LinkedIn id rather than its name', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', people: [], page: { hasMore: false } })])
    await createSocialFetchSource(f.impl).searchPeople({ ref: '630969', name: 'Motion Software' }, { titles: ['Marketing'] })
    expect(f.calls[0].searchParams.get('currentCompany')).toBe('630969')
    expect(f.calls[0].searchParams.get('title')).toBe('Marketing')
    expect(f.calls[0].searchParams.has('keyword')).toBe(false)
  })

  it('uses filters on company search itself instead of hiding results afterwards', async () => {
    const f = fakeFetch([orgs(['9'], { hasMore: false })])
    const page = await createSocialFetchSource(f.impl).searchCompanies({ keyword: 'software', industry: 'Software Development', headcount: ['11-50'], country: 'United Kingdom' })
    expect([f.calls[0].searchParams.get('industry'), f.calls[0].searchParams.get('headcountRange')]).toEqual(['4', '11-50'])
    expect(f.calls[0].searchParams.get('geoEntityId')).toBeTruthy()
    // The result has no headcount or country: it's kept, since SocialFetch filtered it.
    expect(page.items.map((c) => c.ref)).toEqual(['9'])
  })
})

describe('meterCredits', () => {
  const emptySearch = (credits: number) => envelope({ lookupStatus: 'found', people: [], page: { hasMore: false } }, credits)

  it('adds up what SocialFetch charged inside it, and keeps concurrent searches apart', async () => {
    const src = createSocialFetchSource(fakeFetch([emptySearch(3), emptySearch(3), emptySearch(6)]).impl, () => 'sfk_test')
    const [a, b] = await Promise.all([
      meterCredits(async () => {
        await src.searchPeople(null, { titles: ['CFO'] })
        await src.searchPeople(null, { titles: ['CFO'] })
      }),
      meterCredits(() => src.searchPeople(null, { titles: ['CTO'] })),
    ])
    expect(a.credits + b.credits).toBe(12)
    expect([a.credits, b.credits].sort()).toEqual([3, 9].sort())
    // Outside a meter nothing is counted, and nothing breaks.
    const lone = createSocialFetchSource(fakeFetch([emptySearch(3)]).impl, () => 'sfk_test')
    await lone.searchPeople(null, { titles: ['CEO'] })
  })
})

describe('getCompany', () => {
  it('never asks for organization 0 (a result mapped before 0 meant no page)', async () => {
    const f = fakeFetch([])
    expect(await createSocialFetchSource(f.impl).getCompany('0')).toBeNull()
    expect(await createSocialFetchSource(f.impl).getCompany('')).toBeNull()
    expect(f.calls).toHaveLength(0)
  })

  it('still looks up real ids', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', organization: { liveOrganizationId: '167872', name: 'Stripe', website: 'https://stripe.com' } }, 6)])
    const company = await createSocialFetchSource(f.impl).getCompany('167872')
    expect(f.calls[0].pathname).toBe('/v2/linkedin/organizations')
    expect(f.calls[0].searchParams.get('id')).toBe('167872')
    expect(company?.domain).toBe('stripe.com')
  })
})
