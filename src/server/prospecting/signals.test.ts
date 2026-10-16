import { describe, expect, it } from 'vitest'
import { hasSignal, monthOf, newInRoleSignal, signalKey, signalScore, withSignals } from './signals'

const now = new Date('2026-10-16T12:00:00Z')

describe('monthOf', () => {
  it('keeps a year or a month, never the day', () => {
    expect(monthOf(2021, now)).toBe('2021')
    expect(monthOf('2021', now)).toBe('2021')
    expect(monthOf('2021-3', now)).toBe('2021-03')
    expect(monthOf('2021-03-15', now)).toBe('2021-03')
    expect(monthOf('2021-03-15T00:00:00Z', now)).toBe('2021-03')
  })

  it('refuses what isn’t a plausible start', () => {
    for (const bad of [null, undefined, '', 'last spring', 1899, '3000', {}]) expect(monthOf(bad, now)).toBeNull()
    // A month that can't be is dropped, leaving the year.
    expect(monthOf('2021-13', now)).toBe('2021')
  })
})

describe('newInRoleSignal', () => {
  it('counts a start in the last 6 months, to the month', () => {
    expect(newInRoleSignal('2026-05', now)).toMatchObject({ kind: 'new_in_role', label: 'New in role · since May 2026', at: '2026-05' })
    expect(newInRoleSignal('2026-10', now)).toMatchObject({ label: 'New in role · since Oct 2026' })
    // Across a year end.
    expect(newInRoleSignal('2025-12', new Date('2026-02-01T00:00:00Z'))).toMatchObject({ label: 'New in role · since Dec 2025' })
    expect(newInRoleSignal('2026-03', now)).toBeNull()
    expect(newInRoleSignal('2027-01', now)).toBeNull()
  })

  it('with only the year, a start this year, saying so', () => {
    expect(newInRoleSignal('2026', now)).toMatchObject({ label: 'New in role · started 2026' })
    expect(newInRoleSignal('2025', now)).toBeNull()
    expect(newInRoleSignal(null, now)).toBeNull()
    expect(newInRoleSignal('soon', now)).toBeNull()
  })
})

describe('signalKey', () => {
  it('files a company by its domain, else its name and country', () => {
    expect(signalKey({ domain: 'WWW.Acme.com' })).toBe('acme.com')
    expect(signalKey({ name: 'The Acme Group Ltd.', country: 'United Kingdom' })).toBe('name:acme|united kingdom')
    expect(signalKey({ name: '' })).toBeNull()
  })
})

describe('combining signals', () => {
  it('keeps one of each kind, the later winning, and scores warm highest', () => {
    const warm = { kind: 'warm' as const, label: 'Warm · 1 reply', source: 'workspace' as const }
    const merged = withSignals(withSignals({ signals: [] as any[] }, [warm, null]), [{ ...warm, label: 'Warm · 2 replies' }, newInRoleSignal('2026-09', now)])
    expect(merged.signals.map((s) => s.label)).toEqual(['Warm · 2 replies', 'New in role · since Sep 2026'])
    expect(hasSignal(merged, ['new_in_role'])).toBe(true)
    expect(hasSignal(merged, ['hiring'])).toBe(false)
    expect(signalScore(merged.signals)).toBeGreaterThan(signalScore([newInRoleSignal('2026-09', now)!]))
    // Nothing to add leaves the object as it was.
    const plain = { signals: undefined }
    expect(withSignals(plain, [null])).toBe(plain)
  })
})
