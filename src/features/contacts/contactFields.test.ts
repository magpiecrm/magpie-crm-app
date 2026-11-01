import { describe, expect, it } from 'vitest'
import { DEFAULT_COLUMNS, columnsToSave, visibleColumns } from './contactColumns'
import { coerceCustomValue, fieldProblem, slugifyFieldKey, validateFieldKey, type ContactFieldDef } from './contactFields'
import { contactExportColumnsWith } from './exportColumns'

const field = (type: ContactFieldDef['type'], options?: string[]): ContactFieldDef => ({ key: 'f', label: 'Field', type, options, created_at: 'now' })
const value = (raw: unknown, def: ContactFieldDef, current?: any) => {
  const out = coerceCustomValue(raw, def, { current })
  return out.ok ? out.value : 'REFUSED'
}

describe('coerceCustomValue', () => {
  it('reads nothing as null, whatever the type', () => {
    for (const type of ['text', 'number', 'date', 'boolean', 'select', 'multiselect'] as const) {
      for (const blank of [undefined, null, '', '   ', []]) expect(value(blank, field(type, ['A']))).toBeNull()
    }
  })

  it('keeps text, up to its limit', () => {
    expect(value('  Hello ', field('text'))).toBe('Hello')
    expect(value(12, field('text'))).toBe('12')
    expect(value('x'.repeat(501), field('text'))).toBe('REFUSED')
  })

  it('reads numbers, with or without thousands commas', () => {
    expect(value('1234.5', field('number'))).toBe(1234.5)
    expect(value('1,234.50', field('number'))).toBe(1234.5)
    expect(value('-5', field('number'))).toBe(-5)
    expect(value(7, field('number'))).toBe(7)
    expect(value('12 apples', field('number'))).toBe('REFUSED')
    expect(value('1,23', field('number'))).toBe('REFUSED')
  })

  it('takes real dates in one unambiguous form', () => {
    expect(value('2026-03-31', field('date'))).toBe('2026-03-31')
    expect(value('2026-03-31T10:00:00.000Z', field('date'))).toBe('2026-03-31')
    expect(value('2026-02-30', field('date'))).toBe('REFUSED')
    expect(value('01/02/2024', field('date'))).toBe('REFUSED')
  })

  it('reads yes and no', () => {
    for (const yes of ['yes', 'Y', 'TRUE', '1', true]) expect(value(yes, field('boolean'))).toBe(true)
    for (const no of ['no', 'n', 'false', '0', false]) expect(value(no, field('boolean'))).toBe(false)
    expect(value('maybe', field('boolean'))).toBe('REFUSED')
  })

  it('matches options in any case and gives them as they were written', () => {
    expect(value('saas', field('select', ['SaaS', 'Retail']))).toBe('SaaS')
    expect(value('Other', field('select', ['SaaS']))).toBe('REFUSED')
    expect(value('saas, RETAIL', field('multiselect', ['SaaS', 'Retail']))).toEqual(['SaaS', 'Retail'])
    expect(value(['SaaS', 'SaaS'], field('multiselect', ['SaaS']))).toEqual(['SaaS'])
    expect(value('SaaS, Other', field('multiselect', ['SaaS']))).toBe('REFUSED')
  })

  it("leaves a contact's value alone after its option has gone, without letting it be chosen anew", () => {
    expect(value('Old', field('select', ['New']), 'Old')).toBe('Old')
    expect(value('Old', field('select', ['New']))).toBe('REFUSED')
    expect(value(['Old', 'New'], field('multiselect', ['New']), ['Old'])).toEqual(['Old', 'New'])
  })
})

describe('fieldProblem', () => {
  const other: ContactFieldDef = { key: 'plan', label: 'Plan', type: 'text', created_at: 'now' }

  it('wants a name of its own', () => {
    expect(fieldProblem({ label: ' ', type: 'text' }, [])).toMatch(/name/)
    expect(fieldProblem({ label: 'plan', type: 'text' }, [other])).toMatch(/already a field/)
    expect(fieldProblem({ label: 'COMPANY', type: 'text' }, [])).toMatch(/standard column/)
    expect(fieldProblem({ label: 'Tier', type: 'text' }, [other])).toBeNull()
  })

  it('names every standard export column', () => {
    for (const { header } of contactExportColumnsWith([])) expect(fieldProblem({ label: header, type: 'text' }, [])).toMatch(/standard column/)
  })

  it('wants usable options on a choice field', () => {
    expect(fieldProblem({ label: 'Tier', type: 'select', options: [] }, [])).toMatch(/at least one/)
    expect(fieldProblem({ label: 'Tier', type: 'select', options: ['A,B'] }, [])).toMatch(/no commas/)
    expect(fieldProblem({ label: 'Tier', type: 'multiselect', options: ['A', 'a'] }, [])).toMatch(/once/)
    expect(fieldProblem({ label: 'Tier', type: 'select', options: ['A'] }, [])).toBeNull()
  })
})

describe('field keys', () => {
  it('start with a letter and stay out of the way of built-ins', () => {
    expect(slugifyFieldKey('2024 Spend')).toBe('field_2024_spend')
    expect(slugifyFieldKey('Deal size (£)')).toBe('deal_size')
    expect(validateFieldKey('first_name')).toMatch(/built-in/)
    expect(validateFieldKey('constructor')).toMatch(/built-in/)
    expect(validateFieldKey('field_2024_spend')).toBeNull()
  })
})

describe('table columns', () => {
  const defs: ContactFieldDef[] = [{ key: 'plan', label: 'Plan', type: 'text', created_at: 'now' }]

  it('falls back to the defaults, and drops what no longer exists', () => {
    expect(visibleColumns('list', undefined, defs)).toEqual(DEFAULT_COLUMNS.list)
    expect(visibleColumns('contacts', ['custom:plan', 'custom:gone', 'nothing', 'email'], defs)).toEqual(['contact', 'custom:plan', 'email'])
  })

  it('saves the pinned column first, once, and refuses what it does not know', () => {
    expect(columnsToSave(['email', 'contact', 'email', 'custom:plan'], defs)).toEqual(['contact', 'email', 'custom:plan'])
    expect(() => columnsToSave(['custom:gone'], defs)).toThrow(/no column/)
    expect(() => columnsToSave(Array.from({ length: 21 }, (_, i) => `custom:plan${i}`), defs.concat(Array.from({ length: 21 }, (_, i) => ({ key: `plan${i}`, label: 'x', type: 'text' as const, created_at: 'now' }))))).toThrow(/up to 20/)
  })
})
