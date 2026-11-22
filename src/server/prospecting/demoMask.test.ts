import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDemoVault,
  demoCompanySearch,
  demoCompanySignals,
  demoPeopleSearch,
  demoResolveCompany,
  demoReveal,
  maskCompany,
  maskCompanyName,
  maskDomain,
  maskEmail,
  maskPerson,
  maskTitle,
  unmaskCompanyRef,
  unmaskPerson,
} from './demoMask'
import type { CompanyResult, PersonResult } from './types'

const jane: PersonResult = {
  profileUrl: 'https://www.linkedin.com/in/jane-smith-123',
  firstName: 'Jane',
  lastName: 'Smith',
  title: 'Head of Sales at Acme Widgets | ex-Initech',
  seniority: 'head',
  company: 'Acme Widgets Ltd',
  companyRef: '424242',
  companySlug: 'acme-widgets',
  companyDomain: 'acmewidgets.co.uk',
  country: 'United Kingdom',
  source: 'web',
  signals: [{ kind: 'hiring', label: 'Hiring · 3 open roles', detail: 'Jobs listed on careers.acmewidgets.co.uk.', url: 'https://careers.acmewidgets.co.uk', source: 'web' }],
  otherJobs: [{ title: 'Advisor', company: 'Initech', companyRef: '7' }],
}

const acme: CompanyResult = {
  ref: '424242',
  name: 'Acme Widgets Ltd',
  domain: 'acmewidgets.co.uk',
  industry: 'Software Development',
  headcount: 120,
  companyType: null,
  country: 'United Kingdom',
  linkedinUrl: 'https://www.linkedin.com/company/acme-widgets',
  source: 'socialfetch',
}

/** Everything a masked value could give away about Jane or Acme, as it would go to the browser. */
const leaks = (value: unknown) => JSON.stringify(value).match(/jane|smith|acme|widgets|initech|424242|linkedin\.com/i)

beforeEach(() => clearDemoVault())

describe('masking text', () => {
  it('keeps the first letter of each name and the kind of company', () => {
    expect(maskCompanyName('Acme Widgets Ltd')).toBe('A*** W*** Ltd')
    expect(maskDomain('acmewidgets.co.uk')).toBe('a***.co.uk')
    expect(maskEmail('jane.smith@acmewidgets.com')).toBe('j***@a***.com')
  })

  it('takes the employer out of a headline title', () => {
    expect(maskTitle('Head of Sales at Acme Widgets | ex-Initech', 'Acme Widgets Ltd')).toBe('Head of Sales at A*** W***')
    expect(maskTitle('Founder @ Acme', '')).toBe('Founder @ A***')
    expect(maskTitle('CTO, Acme Widgets', 'Acme Widgets')).toBe('CTO, A*** W***')
    expect(maskTitle('Marketing Director', 'Acme')).toBe('Marketing Director')
  })
})

describe('a masked person', () => {
  it('shows nobody, and comes back as the real one', () => {
    const masked = maskPerson(jane)
    expect(leaks(masked)).toBeNull()
    expect(masked).toMatchObject({ firstName: 'J***', lastName: 'S***', company: 'A*** W*** Ltd', companyDomain: 'a***.co.uk', companySlug: null, masked: true })
    expect(masked.signals?.[0]).toMatchObject({ label: 'Hiring · 3 open roles', url: null, detail: undefined })
    expect(unmaskPerson(masked)).toEqual(jane)
  })

  it('is the same row on every page', () => {
    expect(maskPerson(jane).profileUrl).toBe(maskPerson({ ...jane }).profileUrl)
  })

  it('keeps a company website typed in by hand, not a starred one', () => {
    const masked = maskPerson({ ...jane, companyDomain: null })
    expect(unmaskPerson({ ...masked, companyDomain: 'acme.example' }).companyDomain).toBe('acme.example')
    expect(unmaskPerson({ ...masked, companyDomain: 'a***.example' }).companyDomain).toBeNull()
  })

  it("isn't found once forgotten, or when it was never masked", () => {
    const masked = maskPerson(jane)
    clearDemoVault()
    expect(() => unmaskPerson(masked)).toThrow(/expired/)
    expect(() => unmaskPerson(jane)).toThrow(/expired/)
  })
})

describe('a masked company', () => {
  it('has a token for a ref and no link', () => {
    const masked = maskCompany(acme)
    expect(leaks(masked)).toBeNull()
    expect(masked).toMatchObject({ name: 'A*** W*** Ltd', domain: 'a***.co.uk', linkedinUrl: null, industry: 'Software Development', headcount: 120 })
    expect(unmaskCompanyRef(masked.ref)).toEqual({ ref: '424242', name: 'Acme Widgets Ltd', domain: 'acmewidgets.co.uk', country: 'United Kingdom' })
  })

  it('has the same ref whether found by company or through a person', () => {
    expect(maskPerson(jane).companyRef).toBe(maskCompany(acme).ref)
  })

  it("won't stand in for a ref the page didn't get from here", () => {
    expect(() => unmaskCompanyRef('424242')).toThrow(/expired/)
  })
})

describe('a people search in demo mode', () => {
  it('runs on the real company and cursor, and sends back only masked people, as they stream too', async () => {
    const company = maskCompany(acme)
    const firstPage = await demoCompanySearch<{ keyword: string; cursor?: string }>({ keyword: 'widgets' }, async () => ({ items: [], nextCursor: 'real-cursor', reportedTotal: null, warnings: [] }))
    const run = vi.fn(async (_input: unknown, opts: { onPeople?: (found: { items: PersonResult[]; refined: string[] }) => void }) => {
      opts.onPeople?.({ items: [jane], refined: [jane.profileUrl] })
      return {
        items: [jane],
        refined: [jane.profileUrl],
        resumed: false,
        nextCursor: 'next-real-cursor',
        reportedTotal: 10,
        warnings: ["That's everyone at Acme Widgets Ltd: 1 person.", 'Jane Smith was left out.'],
        details: ['Searched acmewidgets.co.uk.'],
      }
    })
    const streamed: unknown[] = []
    const page = await demoPeopleSearch(
      { titles: ['Head of Sales'], company: { ref: company.ref, name: company.name }, cursor: firstPage.nextCursor! },
      { onPeople: (found) => streamed.push(found) },
      run,
    )
    expect(run.mock.calls[0][0]).toMatchObject({ titles: ['Head of Sales'], company: { ref: '424242', name: 'Acme Widgets Ltd' }, cursor: 'real-cursor' })
    expect(leaks(page)).toBeNull()
    expect(leaks(streamed)).toBeNull()
    expect(page.items[0].firstName).toBe('J***')
    expect(page.refined).toEqual([page.items[0].profileUrl])
    expect(page.warnings).toEqual(["That's everyone at A*** W*** Ltd: 1 person.", 'J*** S*** was left out.'])
    expect(page.nextCursor).toMatch(/^demo-cursor-/)
  })

  it('leaves out a company when none was asked for', async () => {
    const run = vi.fn(async () => ({ items: [], refined: [], resumed: false, nextCursor: null, reportedTotal: null, warnings: [] }))
    await demoPeopleSearch<{ titles: string[]; cursor?: string }>({ titles: ['CEO'] }, {}, run)
    expect(run.mock.calls[0]).toEqual([{ titles: ['CEO'], cursor: undefined }, expect.anything()])
  })
})

describe('a Reveal in demo mode', () => {
  it('finds the real email and shows it masked', async () => {
    const masked = maskPerson(jane)
    const run = vi.fn(async (p: PersonResult) => ({ status: 'found' as const, email: `${p.firstName.toLowerCase()}@${p.companyDomain}`, emailStatus: 'verified' as const, domain: p.companyDomain!, greylisted: false }))
    const result = await demoReveal(masked, run)
    expect(run.mock.calls[0][0].profileUrl).toBe(jane.profileUrl)
    expect(result).toMatchObject({ status: 'found', email: 'j***@a***.co.uk', domain: 'a***.co.uk', emailStatus: 'verified' })
  })

  it("doesn't name the company in its wording or offer its real domain", async () => {
    const masked = maskPerson(jane)
    const result = await demoReveal(masked, async () => ({ status: 'not_found' as const, message: 'No address at acmewidgets.co.uk took mail for Acme Widgets Ltd.', canFixDomain: true, suggestedDomain: 'acme-mail.co.uk' }))
    expect(leaks(result)).toBeNull()
    expect(result).toEqual({ status: 'not_found', message: 'No address at a***.co.uk took mail for A*** W*** Ltd.', canFixDomain: true })
  })
})

describe('company lookups in demo mode', () => {
  it('finds a website by the real ref and shows it masked', async () => {
    const masked = maskCompany({ ...acme, domain: null })
    const run = vi.fn(async (ref: string) => ({ ref, domain: 'acmewidgets.co.uk', catchAll: false }))
    expect(await demoResolveCompany(masked.ref, run)).toEqual({ ref: masked.ref, domain: 'a***.co.uk', catchAll: false })
    expect(run).toHaveBeenCalledWith('424242')
    expect(unmaskCompanyRef(masked.ref).domain).toBe('acmewidgets.co.uk')
  })

  it('looks up signals for the real companies and answers by masked ref, without where they were seen', async () => {
    const masked = maskCompany(acme)
    const other = maskCompany({ ...acme, ref: '99', name: 'Globex', domain: 'globex.example' })
    const run = vi.fn(async () => ({
      signals: { 'acmewidgets.co.uk': [{ kind: 'funding' as const, label: 'Raised Series A', detail: 'Reported on news.example.', url: 'https://news.example/acme', source: 'web' as const }] },
      pending: ['globex.example'],
    }))
    const answer = await demoCompanySignals([{ ref: masked.ref }, { ref: other.ref }, { ref: 'not-ours' }, {}], run)
    expect(run).toHaveBeenCalledWith([
      { name: 'Acme Widgets Ltd', domain: 'acmewidgets.co.uk', country: 'United Kingdom' },
      { name: 'Globex', domain: 'globex.example', country: 'United Kingdom' },
    ])
    expect(answer).toEqual({ signals: { [masked.ref]: [{ kind: 'funding', label: 'Raised Series A', detail: undefined, url: null, source: 'web' }] }, pending: [other.ref] })
  })
})

describe('saving in demo mode', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE
  })

  it('is refused before anything runs', async () => {
    process.env.DEMO_MODE = 'on'
    const { startSave } = await import('./search')
    await expect(startSave(1, [jane])).rejects.toThrow(/demo workspace/)
  })
})
