import { describe, expect, it } from 'vitest'
import { buildCsv } from '../../utils/export'
import { coerceCustomValue, type ContactCustomValue, type ContactFieldDef } from './contactFields'
import { autoDetectMappings, cleanCustomCell, guessField, importProblems, inferFieldType, parseCSV, parseSpreadsheet } from './contactImport'
import { contactExportColumnsWith } from './exportColumns'

const field = (key: string, label: string, type: ContactFieldDef['type'], options?: string[]): ContactFieldDef => ({ key, label, type, options, created_at: 'now' })

const fields = [
  field('note', 'Note', 'text'),
  field('balance', 'Balance', 'number'),
  field('renews', 'Renews', 'date'),
  field('paid', 'Paid', 'boolean'),
  field('plan', 'Plan', 'select', ['Free', 'Pro']),
  field('tags', 'Tags', 'multiselect', ['VIP', 'Beta']),
]

describe('working out the columns', () => {
  const header = (...cells: string[]) => autoDetectMappings([cells, cells.map(() => 'x')], true, fields)

  it("doesn't take a header for a built-in because it contains the word", () => {
    expect(header('Email', 'Last purchase', 'Company size', 'Payroll', 'Mailing group')).toEqual({ 0: 'email', 1: 'skip', 2: 'skip', 3: 'skip', 4: 'skip' })
  })

  it('still knows what built-ins go by, and an email column by name', () => {
    expect(header('Work Email', 'First name', 'Surname', 'Organisation', 'Job_Title', 'Country')).toEqual({ 0: 'email', 1: 'firstName', 2: 'lastName', 3: 'company', 4: 'jobTitle', 5: 'country' })
    expect(header('Primary email')[0]).toBe('email')
  })

  it('finds a custom field by label or key, BOM and all', () => {
    expect(header('﻿Email', 'plan', 'BALANCE')).toEqual({ 0: 'email', 1: 'custom:plan', 2: 'custom:balance' })
  })

  it('leaves the second of two columns with one name skipped', () => {
    expect(header('Email', 'Plan', 'Plan')).toEqual({ 0: 'email', 1: 'custom:plan', 2: 'skip' })
  })

  it('finds a field exported with its key, from before labels had to be unique', () => {
    const old = [field('co', 'Company', 'text')]
    expect(autoDetectMappings([['Company', 'Company (co)'], ['a', 'b']], true, old)).toEqual({ 0: 'company', 1: 'custom:co', })
  })

  it('still finds email in the data when the headers say nothing', () => {
    expect(autoDetectMappings([['Contact', 'Plan'], ['a@x.co', 'Pro']], true, fields)[0]).toBe('email')
  })
})

describe('guessing a new field', () => {
  it('goes by what is in the column', () => {
    expect(inferFieldType(['1', '2,000', '', '3.5']).type).toBe('number')
    expect(inferFieldType(['2026-01-01', '2026-02-01']).type).toBe('date')
    expect(inferFieldType(['yes', 'No']).type).toBe('boolean')
    expect(inferFieldType(['Gold', 'Silver', 'gold', 'Silver'])).toEqual({ type: 'select', options: ['Gold', 'Silver'] })
    expect(inferFieldType(['one', 'two', 'three']).type).toBe('text')
    expect(inferFieldType(['']).type).toBe('text')
  })

  it('starts from the column header', () => {
    expect(guessField([['Email', 'Spend'], ['a@x.co', '10']], true, 1)).toEqual({ label: 'Spend', type: 'number' })
    expect(guessField([['a@x.co', 'x']], false, 1).label).toBe('')
  })
})

describe('checking an import before it runs', () => {
  it('counts what will not fit, field by field, and ignores blanks', () => {
    const grid = [['Email', 'Balance', 'Plan'], ['a@x.co', 'lots', 'Pro'], ['b@x.co', '', 'Gold'], ['c@x.co', 'more', 'Free']]
    const problems = importProblems(grid, true, { 0: 'email', 1: 'custom:balance', 2: 'custom:plan' }, fields)
    expect(problems).toMatchObject([{ label: 'Balance', count: 2, example: 'lots' }, { label: 'Plan', count: 1, example: 'Gold' }])
    expect(importProblems(grid, true, { 0: 'email', 1: 'skip' }, fields)).toEqual([])
  })
})

describe('exporting and importing again', () => {
  const contacts: Array<{ email: string; custom: Record<string, ContactCustomValue> }> = [
    { email: 'a@x.co', custom: { note: 'Likes, commas "and" quotes', balance: -5, renews: '2026-03-31', paid: true, plan: 'Pro', tags: ['VIP', 'Beta'] } },
    { email: 'b@x.co', custom: { note: '+44 7700 900000', balance: 1234.5, renews: '2025-12-01', paid: false, plan: 'Free', tags: ['Beta'] } },
    { email: 'c@x.co', custom: {} },
  ]
  const columns = contactExportColumnsWith(fields)

  /** Reads a grid back as an import would, and checks every value comes out as it went in. */
  const expectSame = (grid: string[][]) => {
    const mappings = autoDetectMappings(grid, true, fields)
    expect(importProblems(grid, true, mappings, fields)).toEqual([])
    grid.slice(1).forEach((row, i) => {
      for (const def of fields) {
        const column = Number(Object.keys(mappings).find((c) => mappings[Number(c)] === `custom:${def.key}`))
        const out = coerceCustomValue(cleanCustomCell(row[column] ?? ''), def)
        expect(out).toEqual({ ok: true, value: contacts[i].custom[def.key] ?? null })
      }
    })
  }

  it('keeps every type through a CSV', () => {
    const csv = buildCsv(contacts, columns)
    expect(csv).toContain("'-5")
    expectSame(parseCSV(csv, ','))
  })

  it('keeps every type through a spreadsheet, with real dates as well', async () => {
    const { utils, write } = await import('xlsx')
    const sheet = utils.aoa_to_sheet([columns.map((c) => c.header), ...contacts.map((c) => columns.map((col) => String(col.value(c) ?? '')))])
    const book = utils.book_new()
    utils.book_append_sheet(book, sheet, 'Sheet1')
    const file = new File([write(book, { bookType: 'xlsx', type: 'array' })], 'contacts.xlsx')
    expectSame(await parseSpreadsheet(file))

    const dated = utils.book_new()
    utils.book_append_sheet(dated, utils.aoa_to_sheet([['Email', 'Renews'], ['a@x.co', { t: 'n', v: 46112, z: 'm/d/yy' }]]), 'Sheet1')
    const grid = await parseSpreadsheet(new File([write(dated, { bookType: 'xlsx', type: 'array' })], 'dated.xlsx'))
    expect(coerceCustomValue(grid[1][1], fields[2])).toEqual({ ok: true, value: '2026-03-31' })
  })
})
