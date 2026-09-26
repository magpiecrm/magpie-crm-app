import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinderDeps } from './emailFinder'
import type { CompanySource, PersonResult } from './types'

// Reveal against an in-memory db, a fake company source and a fake Reacher.

const state = { suppression: [] as Array<{ hash: string }>, disclosure: [] as any[], companies: [] as any[] }
const fakeDb = {
  getSuppressionHashes: () => new Set(state.suppression.map((s) => s.hash)),
  addDisclosure: (e: any) => state.disclosure.push(e),
  getProspectCompany: (ref: string) => state.companies.find((c) => c.ref === ref) ?? null,
  upsertProspectCompanies: (entries: any[]) => state.companies.push(...entries),
}
vi.mock('../db', () => ({ db: fakeDb }))

const { revealEmail } = await import('./reveal')
const { hashesFor } = await import('./suppression')

const source: CompanySource = {
  searchCompanies: async () => ({ items: [], nextCursor: null, reportedTotal: null, warnings: [] }),
  getCompany: vi.fn(async () => ({
    ref: '9', name: 'Acme', domain: 'acme.com', industry: null, headcount: null, companyType: null, country: null, linkedinUrl: null, source: 'socialfetch' as const,
  })),
}

const check = vi.fn(async (email: string) => ({
  reachability: email === 'jane.smith@acme.com' ? ('safe' as const) : ('invalid' as const),
  isCatchAll: null,
  outcome: 'ok' as const,
}))
const finder: FinderDeps = {
  getDomain: () => null,
  updateDomain: (d, patch) => ({ domain: d, pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: false, catch_all_checked_at: 'x', mx_provider: 'other', accepts_mail: true, mx_checked_at: 'x', last_used_at: 'x', ...patch }) as any,
  resolveMx: async () => ['mx.acme.com'],
  verifier: { acquire: async () => ({ proxy: null, report: () => {} }), check: (email) => check(email) },
  now: () => Date.now(),
}

const jane: PersonResult = {
  profileUrl: 'https://www.linkedin.com/in/jane', firstName: 'Jane', lastName: 'Smith', title: 'Head of Data', seniority: 'head',
  company: 'Acme', companyRef: '9', companyDomain: null, country: 'United Kingdom', source: 'socialfetch', profileChecked: true,
}

beforeEach(() => {
  state.suppression = []
  state.disclosure = []
  state.companies = []
  check.mockClear()
  vi.mocked(source.getCompany).mockClear()
})

describe('revealEmail', () => {
  it('finds and verifies the address, and logs the reveal as hashes only', async () => {
    const res = await revealEmail(jane, { source, finder, db: fakeDb as any })
    expect(res).toEqual({ status: 'found', email: 'jane.smith@acme.com', emailStatus: 'verified', domain: 'acme.com', greylisted: false })
    expect(state.disclosure).toHaveLength(1)
    expect(state.disclosure[0]).toMatchObject({ event: 'revealed', sources: ['socialfetch'] })
    expect(JSON.stringify(state.disclosure)).not.toMatch(/jane|smith|acme/i)
  })

  it('refuses opted-out people before spending anything, without saying why', async () => {
    state.suppression = hashesFor({ profileUrl: jane.profileUrl })
    const res = await revealEmail(jane, { source, finder, db: fakeDb as any })
    expect(res).toEqual({ status: 'unavailable', message: expect.any(String) })
    expect(res.status === 'unavailable' && res.message).not.toMatch(/opt/i)
    expect(check).not.toHaveBeenCalled()
    expect(source.getCompany).not.toHaveBeenCalled()
  })

  it('refuses when the found address is opted out', async () => {
    state.suppression = hashesFor({ email: 'jane.smith@acme.com' })
    const res = await revealEmail(jane, { source, finder, db: fakeDb as any })
    expect(res.status).toBe('unavailable')
    expect(state.disclosure).toEqual([])
  })

  it('explains when there is no domain to work with', async () => {
    const res = await revealEmail({ ...jane, companyRef: null }, { source, finder, db: fakeDb as any })
    expect(res).toEqual({ status: 'no_domain', message: "We don't know where they work.", canFixDomain: false })
  })

  it('uses a domain the user set for the company over the one on the search result', async () => {
    state.companies.push({ ref: '9', name: 'Acme', domain: 'acme.com', domain_source: 'user' })
    const res = await revealEmail({ ...jane, companyDomain: 'careers.acme-old.com' }, { source, finder, db: fakeDb as any })
    expect(res).toMatchObject({ status: 'found', email: 'jane.smith@acme.com' })
  })

  it('offers a domain fix when the company domain takes no email', async () => {
    const records = new Map<string, any>()
    const noMail: FinderDeps = {
      ...finder,
      getDomain: (d) => records.get(d) ?? null,
      updateDomain: (d, patch) => {
        const rec = { domain: d, pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: null, catch_all_checked_at: null, mx_provider: null, accepts_mail: null, mx_checked_at: null, last_used_at: '', ...records.get(d), ...patch }
        records.set(d, rec)
        return rec
      },
      resolveMx: async () => [],
    }
    const res = await revealEmail({ ...jane, companyDomain: 'jlr.com' }, { source, finder: noMail, db: fakeDb as any })
    expect(res).toMatchObject({ status: 'not_found', canFixDomain: true, message: expect.stringMatching(/jlr\.com doesn't receive email/) })
  })

  it('withholds an unconfirmed guess by default, with the reason and no disclosure', async () => {
    const catchAll: FinderDeps = {
      ...finder,
      getDomain: () => ({ domain: 'acme.com', pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: true, catch_all_checked_at: new Date().toISOString(), mx_provider: 'other', accepts_mail: true, mx_checked_at: new Date().toISOString(), last_used_at: '' }),
    }
    const res = await revealEmail(jane, { source, finder: catchAll, db: fakeDb as any })
    expect(res).toEqual({ status: 'unconfirmed', message: 'acme.com accepts every address, so none can be confirmed.', catchAll: true })
    expect(JSON.stringify(res)).not.toContain('jane.smith@')
    expect(state.disclosure).toEqual([])
    expect(check).not.toHaveBeenCalled()
  })

  it('hands over the best guess only when verified-only is switched off', async () => {
    const catchAll: FinderDeps = {
      ...finder,
      getDomain: () => ({ domain: 'acme.com', pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: true, catch_all_checked_at: new Date().toISOString(), mx_provider: 'other', accepts_mail: true, mx_checked_at: new Date().toISOString(), last_used_at: '' }),
    }
    const res = await revealEmail(jane, { source, finder: catchAll, db: fakeDb as any, verifiedOnly: false })
    expect(res).toMatchObject({ status: 'found', email: 'jane.smith@acme.com', emailStatus: 'catch_all_likely' })
  })

  it('reports not_found when every candidate is rejected', async () => {
    const res = await revealEmail({ ...jane, firstName: 'Zed', lastName: 'Nobody' }, { source, finder, db: fakeDb as any })
    expect(res.status).toBe('not_found')
  })
})
