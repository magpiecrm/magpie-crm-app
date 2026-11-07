import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Company research for personalised emails: given the company and never the
// person, with Claude's web tools; kept by company; nothing from our own web search.

// Scratch database (usage counts are written to it), so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'company-research-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

vi.mock('./webSearch', () => ({ webSearcher: () => { throw new Error('our web search must not be used') } }))
vi.mock('./companySignals', () => ({ companySignals: () => { throw new Error('live signal lookups must not be used') } }))

const { knownFacts, researchCompany, researchPrompt, RESEARCH_TTL } = await import('./companyResearch')

function fakeDb() {
  const research: Record<string, any> = {}
  return {
    research,
    data: { prospect_companies: [{ ref: '1', name: 'Larkspur', domain: 'larkspur.test', domain_source: 'socialfetch', headcount: 40, headcount_history: [{ at: '2026-05-01T00:00:00Z', n: 30 }, { at: '2026-10-01T00:00:00Z', n: 40 }], updated_at: '' }] },
    getCompanySignal: (key: string, kind: string) =>
      key === 'larkspur.test' && kind === 'funding' ? { signal: { kind: 'funding', label: 'Raised £2m', detail: 'Seed round, Sept 2026', url: 'https://news.test/larkspur', source: 'web' }, at: '' } : null,
    getCompanyResearch: (key: string) => research[key] ?? null,
    setCompanyResearch: (key: string, entry: any, now = new Date()) => (research[key] = { ...entry, at: now.toISOString() }),
  } as any
}

const company = { name: 'Larkspur', domain: 'larkspur.test', country: 'United Kingdom' }

describe('company research', () => {
  it('asks about the company only, with what is already known, and keeps the facts by company', async () => {
    const db = fakeDb()
    const generate = vi.fn(async (_opts: any) => ({
      answer: {
        facts: [
          { text: 'Larkspur makes onboarding software for accountants.', url: 'https://larkspur.test/' },
          { text: 'Larkspur makes onboarding software for accountants.', url: 'https://larkspur.test/about' },
          { text: 'Opened a Manchester office in 2026.', url: 'not a url' },
          { text: '  ', url: null },
        ],
      },
      web: true,
      model: 'm',
    }))
    const now = new Date('2026-11-06T10:00:00Z')
    const r = await researchCompany(company, { db, generate: generate as any, web: true, now })
    expect(r.facts).toEqual([
      { text: 'Larkspur makes onboarding software for accountants.', url: 'https://larkspur.test/' },
      { text: 'Opened a Manchester office in 2026.', url: null },
    ])
    const opts = generate.mock.calls[0][0]
    expect(opts.web).toEqual({ searches: 3, fetches: 2 })
    expect(opts.prompt).toBe(researchPrompt(company, knownFacts(company, db)))
    expect(opts.prompt).toContain('Website: https://larkspur.test/')
    expect(opts.prompt).toContain('Raised £2m: Seed round, Sept 2026 (https://news.test/larkspur)')
    expect(opts.prompt).toContain('went from 30 to 40')
    expect(db.research['larkspur.test']).toMatchObject({ web: true, at: now.toISOString() })

    // Kept: the next person there costs nothing, until it's a month old.
    await researchCompany(company, { db, generate: generate as any, web: true, now: new Date(now.getTime() + RESEARCH_TTL.found - 1) })
    expect(generate).toHaveBeenCalledTimes(1)
    await researchCompany(company, { db, generate: generate as any, web: true, now: new Date(now.getTime() + RESEARCH_TTL.found + 1) })
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('never puts anything about a person in what it asks', () => {
    const prompt = researchPrompt({ name: 'Larkspur', domain: null, country: null }, [])
    expect(prompt).toBe('Company: Larkspur\nWebsite: not known; find it by searching for the company.')
  })

  it('shares one lookup between people at the same company asked about at once', async () => {
    const db = fakeDb()
    let release!: () => void
    const generate = vi.fn(() => new Promise<any>((resolve) => (release = () => resolve({ answer: { facts: [{ text: 'A fact.', url: null }] }, web: true, model: 'm' }))))
    const a = researchCompany(company, { db, generate: generate as any, web: true })
    const b = researchCompany(company, { db, generate: generate as any, web: true })
    await Promise.resolve()
    release()
    expect((await a).facts).toEqual((await b).facts)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it("without Claude's web tools, uses what is known and asks the AI nothing", async () => {
    const db = fakeDb()
    const generate = vi.fn()
    const r = await researchCompany(company, { db, generate: generate as any, web: false })
    expect(generate).not.toHaveBeenCalled()
    expect(r).toMatchObject({ web: false })
    expect(r.facts.map((f) => f.text)).toEqual([expect.stringContaining('went from 30 to 40'), 'Raised £2m: Seed round, Sept 2026'])
    expect(db.research).toEqual({})
  })
})
