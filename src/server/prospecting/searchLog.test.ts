import { describe, expect, it, vi } from 'vitest'

const lines = new Map<string, any>()
vi.mock('../db', () => ({
  db: {
    addSearchLog: (entry: any) => void lines.set(entry.id, entry),
    noteSearchLookup: (id: string, outcome: string, how: { website?: boolean }) => {
      const line = lines.get(id)
      if (!line) return false
      line.lookups[outcome] = (line.lookups[outcome] ?? 0) + 1
      if (how.website) line.website = (line.website ?? 0) + 1
      return true
    },
  },
}))

import { logSearch, noteSearchLookup } from './searchLog'

const entry = (id: string) => ({ id, at: '2026-11-01T09:00:00.000Z', ms: 1, filters: { titles: [], seniorities: [], industries: [], sizes: [], country: null, company: null, keyword: false, page: 'first' as const }, counts: {} })

describe('noteSearchLookup', () => {
  it('adds a lookup to a search that has finished', async () => {
    await logSearch(entry('done'))
    await noteSearchLookup('done', 'verified', { website: true })
    expect(lines.get('done')).toMatchObject({ lookups: { verified: 1 }, website: 1 })
  })

  it('keeps a lookup made while the search is running for when it finishes, once', async () => {
    await noteSearchLookup('running', 'verified', { website: true })
    await noteSearchLookup('running', 'rejected')
    await logSearch(entry('running'))
    expect(lines.get('running')).toMatchObject({ lookups: { verified: 1, rejected: 1 }, website: 1 })
    lines.delete('running')
    await logSearch(entry('running'))
    expect(lines.get('running').lookups).toEqual({})
  })
})
