import { describe, expect, it } from 'vitest'
import { companySignals } from './companySignals'
import type { Signal } from './types'
import type { WebResult } from './webSearch'

// A self-hosted copy's own lookups (companySignals.ts), with a fake web search and an in-memory cache.

function fakeDb() {
  const kept = new Map<string, { signal: Signal | null; at: string }>()
  return {
    kept,
    getCompanySignal: (key: string, kind: string) => kept.get(`${key}|${kind}`) ?? null,
    setCompanySignal: (key: string, kind: string, signal: Signal | null, now = new Date()) => void kept.set(`${key}|${kind}`, { signal, at: now.toISOString() }),
  } as any
}

const hiringPage = (company: string, domain: string): WebResult[] => [{ url: `https://${domain}/careers`, title: `Careers | ${company}`, description: `${company} is hiring! We are looking for an Account Executive.` }]

describe('companySignals, with its own web search', () => {
  it('searches each company once a kind, keeps the answer, and answers from it next time', async () => {
    const db = fakeDb()
    const asked: string[] = []
    const search = async (query: string) => {
      asked.push(query)
      return query.includes('careers') && query.includes('Larkspur') ? hiringPage('Larkspur Labs', 'larkspurlabs.com') : []
    }
    const companies = [
      { name: 'Larkspur Labs', domain: 'larkspurlabs.com' },
      { name: 'Quillmark Studio', domain: null },
    ]
    const first = await companySignals(companies, { db, search, now: new Date('2026-10-16T12:00:00Z') })
    expect(first.signals['larkspurlabs.com']?.map((s) => s.kind)).toEqual(['hiring'])
    expect(first.signals['name:quillmark studio']).toBeUndefined()
    expect(first.pending).toEqual([])
    expect(asked).toEqual(['"Larkspur Labs" careers jobs', '"Larkspur Labs" funding round', '"Quillmark Studio" careers jobs', '"Quillmark Studio" funding round'])

    // From the cache: no more searches, the same answer.
    const again = await companySignals(companies, { db, search, now: new Date('2026-10-17T12:00:00Z') })
    expect(again.signals['larkspurlabs.com']?.[0].kind).toBe('hiring')
    expect(asked).toHaveLength(4)
    // Nothing found is kept a week for hiring: after that it's asked again.
    await companySignals(companies, { db, search, now: new Date('2026-10-25T12:00:00Z') })
    expect(asked.filter((q) => q.includes('Quillmark') && q.includes('careers'))).toHaveLength(2)
  })

  it('searches only the first few companies live, and says the rest are pending', async () => {
    const db = fakeDb()
    const search = async () => [] as WebResult[]
    const companies = Array.from({ length: 6 }, (_, i) => ({ name: `Company Number ${i}`, domain: `company${i}.example` }))
    const answer = await companySignals(companies, { db, search, liveMax: 2, kinds: ['hiring'] })
    expect(answer.pending).toEqual(['company2.example', 'company3.example', 'company4.example', 'company5.example'])
  })

  it('keeps nothing when a search fails, so it’s tried again', async () => {
    const db = fakeDb()
    const search = async () => {
      throw new Error('down')
    }
    const answer = await companySignals([{ name: 'Larkspur Labs', domain: 'larkspurlabs.com' }], { db, search, kinds: ['hiring'] })
    expect(answer.pending).toEqual(['larkspurlabs.com'])
    expect(db.kept.size).toBe(0)
  })
})
