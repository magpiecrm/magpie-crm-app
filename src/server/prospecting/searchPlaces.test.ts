import { describe, expect, it } from 'vitest'
import { placesFor } from './searchPlaces'

describe('placesFor', () => {
  it('starts with the country and six cities, then moves on without the country', () => {
    const first = placesFor('United States', 1, null)
    expect(first).toMatchObject({ placesOnly: false, next: 'places:6' })
    expect(first.places).toHaveLength(6)
    const second = placesFor('United States', 1, first.next)
    expect(second).toMatchObject({ placesOnly: true, next: 'places:12' })
    expect(second.places).not.toContain(first.places[0])
  })

  it('shares the cities between job titles, down to two each', () => {
    expect(placesFor('United States', 3, null).places).toHaveLength(2)
    expect(placesFor('United States', 2, null).places).toHaveLength(3)
    expect(placesFor('United States', 5, null)).toMatchObject({ next: 'places:2' })
  })

  it('ends at the last city, and starts over from a cursor past it', () => {
    expect(placesFor('Canada', 1, null).next).toBeNull()
    expect(placesFor('United Kingdom', 1, 'places:6')).toMatchObject({ placesOnly: true, next: null })
    expect(placesFor('Canada', 1, 'places:40')).toMatchObject({ placesOnly: false, places: expect.arrayContaining(['Toronto']) })
  })

  it('leaves a country or region it has no cities for to search as a whole', () => {
    expect(placesFor('Portugal', 1, null)).toEqual({ places: [], placesOnly: false, next: null })
    expect(placesFor('California, United States', 1, null).places).toEqual([])
    expect(placesFor(null, 1, null).places).toEqual([])
  })

  it('takes a cursor from another kind of search as the start', () => {
    expect(placesFor('United States', 1, 'eyJwYWdlIjoyfQ==')).toMatchObject({ placesOnly: false, next: 'places:6' })
  })
})
