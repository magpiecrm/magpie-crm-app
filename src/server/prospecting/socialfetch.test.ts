import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalProfileUrl, createSocialFetchSource, domainFromWebsite, mapPerson, sameCompanyName, titleFromHeadline } from './socialfetch'

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
      companyDomain: null,
      country: 'United Kingdom',
      source: 'socialfetch',
    })
    const serialised = JSON.stringify(person)
    for (const dropped of ['Manchester', 'cdn.example', '5400', 'Long bio', 'Somewhere']) {
      expect(serialised).not.toContain(dropped)
    }
  })

  it('reads the company ref from a numeric id, or from the company page slug when there is no id', () => {
    const numeric = mapPerson(rawPerson({ currentPositions: [{ title: 'CFO', organizationName: 'Acme', organizationId: 1234, isCurrent: true }] }))
    expect(numeric?.companyRef).toBe('1234')
    const slugOnly = mapPerson(
      rawPerson({ currentPositions: [{ title: 'CFO', organizationName: 'Acme', organizationUrl: 'https://www.linkedin.com/company/acme-ltd/', isCurrent: true }] }),
    )
    expect(slugOnly?.companyRef).toBe('acme-ltd')
    const noPage = mapPerson(rawPerson({ currentPositions: [{ title: 'Freelance Consultant', organizationName: 'Self-employed', isCurrent: true }] }))
    expect(noPage?.companyRef).toBeNull()
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

  it('sends the key and keyword, dedupes by domain and post-filters', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', organizations: orgs, page: { hasMore: true, nextCursor: 'c2' }, reportedTotal: 812 })])
    const page = await createSocialFetchSource(f.impl).searchCompanies({ keyword: 'acme', industry: 'software', headcount: ['51-200'], country: 'united kingdom' })

    expect(f.calls[0].pathname).toBe('/v2/linkedin/organizations/search')
    expect(f.calls[0].searchParams.get('keyword')).toBe('acme')
    expect(f.headers[0]['x-api-key']).toBe('sfk_test')
    expect(page.items.map((c) => c.name)).toEqual(['Acme', 'No Site'])
    expect(page.items[1].domain).toBeNull()
    expect(page.nextCursor).toBe('c2')
    expect(page.reportedTotal).toBe(812)
    expect(page.warnings[0]).toMatch(/2 of 4 companies/)
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

  it('sends titles as the keyword, never the title parameter', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', people: [], page: { hasMore: false } })])
    await createSocialFetchSource(f.impl).searchPeople(null, { titles: ['Business Analyst'], keyword: 'fintech', count: 5 })
    expect(f.calls[0].searchParams.get('keyword')).toBe('Business Analyst fintech')
    expect(f.calls[0].searchParams.get('count')).toBe('5')
    expect(f.calls[0].searchParams.has('title')).toBe(false)
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
    expect(page.warnings.some((w) => /aren't in Germany/.test(w))).toBe(true)
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
    expect(page.warnings.some((w) => /isn't in the supported country list/.test(w))).toBe(true)
  })

  it('pages by offset when SocialFetch gives no cursor', async () => {
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

  it('with a chosen company, adds it to the keyword and only ties people to it when their headline names it', async () => {
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
    expect(f.calls[0].searchParams.get('keyword')).toBe('Business Analyst Acme')
    expect(page.items.map((p) => [p.firstName, p.companyRef])).toEqual([
      ['In', '1234'],
      // Employer unknown: kept, but not assumed to be Acme (resolved on save).
      ['Un', null],
    ])
    expect(page.warnings).toContain("1 person returned by SocialFetch doesn't currently work at Acme and was hidden.")
  })

  it('runs one request per title and dedupes people across them', async () => {
    const f = fakeFetch([
      envelope({ people: [rawPerson()], page: { hasMore: true, nextCursor: 'cmo-2' } }),
      envelope({ people: [rawPerson()], page: { hasMore: false } }),
      envelope({ people: [rawPerson({ handle: 'p2', profileUrl: 'https://www.linkedin.com/in/p2', firstName: 'Pat' })], page: { hasMore: false } }),
    ])
    const source = createSocialFetchSource(f.impl)
    const first = await source.searchPeople(null, { titles: ['CMO', 'Head of Marketing'] })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).not.toBeNull()

    const second = await source.searchPeople(null, { titles: ['CMO', 'Head of Marketing'], cursor: first.nextCursor! })
    // Only the title with pages left is re-queried, with its own cursor.
    expect(f.calls).toHaveLength(3)
    expect(f.calls[2].searchParams.get('keyword')).toBe('CMO')
    expect(f.calls[2].searchParams.get('cursor')).toBe('cmo-2')
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
    expect(page.warnings).toContain("1 person didn't match your seniority or country filters and is hidden.")
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
    await expect(createSocialFetchSource(f.impl).searchCompanies({ keyword: 'x' })).rejects.toThrow(/Settings → Prospecting/)
  })

  it('treats not_found lookups as null', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'not_found', organization: null })])
    expect(await createSocialFetchSource(f.impl).getCompany('999')).toBeNull()
    expect(f.calls[0].searchParams.get('id')).toBe('999')
  })

  it('looks companies up by slug when the ref is not numeric', async () => {
    const f = fakeFetch([envelope({ lookupStatus: 'found', organization: { liveOrganizationId: '5', name: 'Beta', website: 'beta.dev' } })])
    expect(await createSocialFetchSource(f.impl).getCompany('beta-inc')).toMatchObject({ ref: '5', domain: 'beta.dev' })
    expect(f.calls[0].searchParams.get('slug')).toBe('beta-inc')
  })
})
