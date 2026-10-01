import { describe, expect, it } from 'vitest'
import { createSearchPool, searchPoolKey } from './searchPool'
import type { PersonResult } from './types'

const person = (n: number) => ({ profileUrl: `https://www.linkedin.com/in/p${n}`, firstName: `P${n}` }) as PersonResult
const hits = (at: number, n = 3) => ({ items: Array.from({ length: n }, (_, i) => person(i)), hasMore: true, end: n, reportedTotal: null, at })

describe('search pool', () => {
  it('hands held people out once', () => {
    const pool = createSearchPool({ now: () => 0 })
    pool.put('k', hits(0))
    expect(pool.take('k')?.items).toHaveLength(3)
    expect(pool.take('k')).toBeNull()
  })

  it('keeps them for an hour from when they were fetched, however often they are split', () => {
    let now = 0
    const pool = createSearchPool({ now: () => now })
    pool.put('a', hits(0))
    now = 59 * 60_000
    const taken = pool.take('a')!
    pool.put('b', { ...taken, items: taken.items.slice(1) })
    now = 60 * 60_000
    expect(pool.take('b')).toBeNull()
  })

  it('holds a limited number of searches, dropping the oldest', () => {
    const pool = createSearchPool({ now: () => 0, maxSearches: 2 })
    pool.put('a', hits(0))
    pool.put('b', hits(0))
    pool.put('c', hits(0))
    expect(pool.size()).toBe(2)
    expect(pool.take('a')).toBeNull()
  })

  it('holds nothing for an empty remainder', () => {
    const pool = createSearchPool({ now: () => 0 })
    pool.put('a', hits(0, 0))
    expect(pool.size()).toBe(0)
  })

  it('keys by the request filters and the offset, not their order or empty ones', () => {
    expect(searchPoolKey({ keyword: 'BA', geoEntityId: '1', industry: undefined }, 25)).toBe(searchPoolKey({ geoEntityId: '1', keyword: 'BA' }, 25))
    expect(searchPoolKey({ keyword: 'BA' }, 25)).not.toBe(searchPoolKey({ keyword: 'BA' }, 50))
    expect(searchPoolKey({ keyword: 'BA' }, 0)).not.toBe(searchPoolKey({ keyword: 'CMO' }, 0))
  })
})
