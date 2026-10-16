import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// A company's staff count over time (prospect_companies headcount_history),
// kept on a scratch database: what the "growing" signal will be judged from.

const scratchDir = mkdtempSync(join(tmpdir(), 'headcount-history-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
const { db } = await import('./db')

afterAll(() => {
  vi.useRealTimers()
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const company = (headcount: number, exact = true) => ({ ref: '42', name: 'Acme', domain: 'acme.com', domain_source: 'socialfetch' as const, headcount, headcount_exact: exact })
const history = () => db.data.prospect_companies!.find((c) => c.ref === '42')!.headcount_history?.map((h) => [h.at.slice(0, 10), h.n])

describe('headcount history', () => {
  it('keeps exact counts at least 25 days apart, the last 8, and never a size range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00Z'))
    db.upsertProspectCompanies([company(100)])
    // Ten days later: too soon for another.
    vi.setSystemTime(new Date('2026-01-11T09:00:00Z'))
    db.upsertProspectCompanies([company(104)])
    // A size range's floor isn't a count.
    vi.setSystemTime(new Date('2026-02-15T09:00:00Z'))
    db.upsertProspectCompanies([company(51, false)])
    expect(history()).toEqual([['2026-01-01', 100]])
    db.upsertProspectCompanies([company(120)])
    expect(history()).toEqual([
      ['2026-01-01', 100],
      ['2026-02-15', 120],
    ])
    for (let month = 3; month <= 12; month++) {
      vi.setSystemTime(new Date(`2026-${String(month).padStart(2, '0')}-20T09:00:00Z`))
      db.upsertProspectCompanies([company(120 + month)])
    }
    expect(history()).toHaveLength(8)
    expect(history()!.at(-1)).toEqual(['2026-12-20', 132])
    // The company's headcount itself is the latest, as before.
    expect(db.getProspectCompany('42')!.headcount).toBe(132)
  })
})
