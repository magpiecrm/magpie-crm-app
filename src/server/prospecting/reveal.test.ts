import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinderDeps } from './emailFinder'
import type { CompanySource, PersonResult } from './types'

// Reveal against an in-memory db, a fake company source and a fake verification server.

let allowance: any = null
const state = { suppression: [] as Array<{ hash: string }>, disclosure: [] as any[], companies: [] as any[], unverifiable: [] as any[] }
const fakeDb = {
  getAllowance: () => allowance,
  getSuppressionHashes: () => new Set(state.suppression.map((s) => s.hash)),
  addDisclosure: (e: any) => state.disclosure.push(e),
  getUnverifiable: () => state.unverifiable,
  setUnverifiable: (entries: any[]) => (state.unverifiable = entries),
  getProspectCompany: (ref: string) => state.companies.find((c) => c.ref === ref) ?? null,
  upsertProspectCompanies: (entries: any[]) => state.companies.push(...entries),
}
vi.mock('../db', () => ({ db: fakeDb }))
// How each lookup ended, as counted for the hit rate.
const lookups: string[] = []
vi.mock('../usage', () => ({ recordUsage: () => {}, recordLookup: (outcome: string) => lookups.push(outcome) }))

const { revealEmail } = await import('./reveal')
const { hashesFor } = await import('./suppression')
const { VerificationLimitError } = await import('./proxyRouter')

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
  allowance = null
  state.suppression = []
  state.disclosure = []
  state.unverifiable = []
  state.companies = []
  lookups.length = 0
  check.mockClear()
  vi.mocked(source.getCompany).mockClear()
})

describe('revealEmail', () => {
  it('stops before looking anything up when the plan has no reveals left', async () => {
    allowance = { periodStart: '2026-10-15T00:00:00Z', periodEnd: null, upgradeUrl: null, limits: { reveals: 20 }, used: { ...{ prospects: 0, reveals: 0, emailsSent: 0 }, reveals: 20 } }
    await expect(revealEmail(jane, { source, finder, db: fakeDb as any })).rejects.toThrow(/used all 20 email reveals/)
    expect(check).not.toHaveBeenCalled()
    expect(source.getCompany).not.toHaveBeenCalled()
  })

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
      getDomain: () => ({ domain: 'acme.com', pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: true, catch_all_confirmed: true, catch_all_checked_at: new Date().toISOString(), mx_provider: 'other', mx_family: 'other', accepts_mail: true, mx_checked_at: new Date().toISOString(), last_used_at: '' }),
    }
    const res = await revealEmail(jane, { source, finder: catchAll, db: fakeDb as any })
    expect(res).toEqual({ status: 'unconfirmed', message: 'acme.com accepts every address, so none can be confirmed.', catchAll: true, unverifiable: true })
    expect(JSON.stringify(res)).not.toContain('jane.smith@')
    expect(state.disclosure).toEqual([])
    // Remembered as a hash of the profile only, so later searches can leave her out.
    expect(state.unverifiable).toEqual([{ hash: hashesFor({ profileUrl: jane.profileUrl })[0].hash, outcome: 'catchAll', created_at: expect.any(String) }])
    expect(JSON.stringify(state.unverifiable)).not.toMatch(/jane|linkedin/i)
    expect(check).not.toHaveBeenCalled()
  })

  it('hands over the best guess only when verified-only is switched off', async () => {
    const catchAll: FinderDeps = {
      ...finder,
      getDomain: () => ({ domain: 'acme.com', pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: true, catch_all_confirmed: true, catch_all_checked_at: new Date().toISOString(), mx_provider: 'other', mx_family: 'other', accepts_mail: true, mx_checked_at: new Date().toISOString(), last_used_at: '' }),
    }
    const res = await revealEmail(jane, { source, finder: catchAll, db: fakeDb as any, verifiedOnly: false })
    expect(res).toMatchObject({ status: 'found', email: 'jane.smith@acme.com', emailStatus: 'catch_all_likely' })
  })

  it('reports not_found when every candidate is rejected', async () => {
    const res = await revealEmail({ ...jane, firstName: 'Zed', lastName: 'Nobody' }, { source, finder, db: fakeDb as any })
    expect(res.status).toBe('not_found')
  })

  it('counts how each lookup ended, for the hit rate', async () => {
    await revealEmail(jane, { source, finder, db: fakeDb as any })
    await revealEmail({ ...jane, companyRef: null }, { source, finder, db: fakeDb as any })
    await revealEmail({ ...jane, firstName: 'Zed', lastName: 'Nobody' }, { source, finder, db: fakeDb as any })
    const limited = { ...finder, verifier: { ...finder.verifier!, acquire: async () => { throw new VerificationLimitError("Today's verification limit is used up.", 'daily_cap') } } }
    await expect(revealEmail(jane, { source, finder: limited, db: fakeDb as any })).rejects.toThrow(/limit is used up/)
    expect(lookups).toEqual(['verified', 'noDomain', 'rejected', 'limit'])
  })

  it("doesn't remember people a retry might verify", async () => {
    const silent: FinderDeps = { ...finder, verifier: { ...finder.verifier!, check: async () => ({ reachability: 'unknown' as const, isCatchAll: null, outcome: 'timeout' as const }) } }
    const res = await revealEmail(jane, { source, finder: silent, db: fakeDb as any })
    expect(res.status).toBe('unconfirmed')
    expect(res.status !== 'found' && res.unverifiable).toBeFalsy()
    expect(state.unverifiable).toEqual([])
  })
})
