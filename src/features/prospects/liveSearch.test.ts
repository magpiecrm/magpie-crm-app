import { describe, expect, it, vi } from 'vitest'
import { liveSearch } from './liveSearch'

const person = (handle: string) => ({ profileUrl: `https://www.linkedin.com/in/${handle}`, firstName: handle }) as any

describe('the people a running search has found so far', () => {
  it('are kept by search, outside the page, and added to as batches come', () => {
    const told = vi.fn()
    const stop = liveSearch.subscribe(told)
    liveSearch.start('a')
    liveSearch.add('a', { items: [person('ana')], refined: ['x'] })
    liveSearch.add('a', { items: [person('ben')], refined: [] })
    liveSearch.start('b')
    liveSearch.add('b', { items: [person('cat')], refined: [] })
    expect(liveSearch.get('a').items.map((p) => p.firstName)).toEqual(['ana', 'ben'])
    expect(liveSearch.get('a').refined).toEqual(['x'])
    expect(liveSearch.get('b').items.map((p) => p.firstName)).toEqual(['cat'])
    expect(told).toHaveBeenCalledTimes(5)
    stop()
    // The same list until it changes, so the page isn't redrawn for nothing.
    expect(liveSearch.get('a')).toBe(liveSearch.get('a'))
    expect(liveSearch.get(null).items).toEqual([])
    expect(liveSearch.get('never searched').items).toEqual([])
  })

  it('start again empty for the next page, and only the latest few searches are kept', () => {
    liveSearch.start('a')
    liveSearch.add('a', { items: [person('ana')], refined: [] })
    liveSearch.start('a')
    expect(liveSearch.get('a').items).toEqual([])
    // A batch from a search that's been dropped goes nowhere.
    for (const key of ['c', 'd', 'e', 'f', 'g', 'h']) liveSearch.start(key)
    liveSearch.add('a', { items: [person('late')], refined: [] })
    expect(liveSearch.get('a').items).toEqual([])
    liveSearch.add('h', { items: [person('hal')], refined: [] })
    expect(liveSearch.get('h').items).toHaveLength(1)
  })
})
