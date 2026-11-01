import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const scratchDir = mkdtempSync(join(tmpdir(), 'contact-field-values-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

vi.mock('./notify', () => ({ notify: () => {} }))

const { db } = await import('./db')
const { createField, editField, writeCustomValues } = await import('./contactFieldValues')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const person = (email: string, custom?: Record<string, any>) => ({ email, first_name: 'Jo', last_name: '', job_title: '', company: '', status: 'subscribed', created_at: 'now', ...(custom ? { custom } : {}) })

beforeEach(() => {
  db.mutate((data) => {
    data.contacts = [person('a@x.co', { plan: 'Pro' }), person('b@x.co')]
    data.contact_fields = []
    data.contact_columns = undefined
  })
  createField({ key: 'plan', label: 'Plan', type: 'select', options: ['Free', 'Pro'] })
  createField({ key: 'seats', label: 'Seats', type: 'number' })
})

describe('writeCustomValues', () => {
  it('writes what fits, reports what does not, and leaves other values alone', () => {
    const out = writeCustomValues([{ email: ' A@x.co', values: { seats: '12', plan: 'Enterprise' } }], { blanks: 'clear' })
    expect(out).toMatchObject({ updated: 1, notFound: [], problems: [{ email: 'a@x.co', field: 'plan' }] })
    expect(db.data.contacts[0].custom).toEqual({ plan: 'Pro', seats: 12 })
  })

  it('refuses a built-in, which is not a field', () => {
    const out = writeCustomValues([{ email: 'a@x.co', values: { first_name: 'Mallory' } }], { blanks: 'clear' })
    expect(out.problems).toHaveLength(1)
    expect(db.data.contacts[0].first_name).toBe('Jo')
  })

  it('clears on a blank, or keeps, as asked', () => {
    writeCustomValues([{ email: 'a@x.co', values: { plan: '' } }], { blanks: 'keep' })
    expect(db.data.contacts[0].custom).toEqual({ plan: 'Pro' })
    writeCustomValues([{ email: 'a@x.co', values: { plan: '' } }], { blanks: 'clear' })
    expect(db.data.contacts[0].custom).toEqual({})
  })

  it('says who it could not find, and saves once however many it changes', () => {
    const save = vi.spyOn(db as any, 'save')
    const out = writeCustomValues([{ email: 'a@x.co', values: { seats: 1 } }, { email: 'b@x.co', values: { seats: 2 } }, { email: 'c@x.co', values: { seats: 3 } }], { blanks: 'keep' })
    expect(out).toMatchObject({ updated: 2, notFound: ['c@x.co'] })
    expect(save).toHaveBeenCalledTimes(1)
    save.mockClear()
    expect(writeCustomValues([{ email: 'a@x.co', values: { seats: 1 } }], { blanks: 'keep' }).updated).toBe(0)
    expect(save).not.toHaveBeenCalled()
    save.mockRestore()
  })

  it('keeps a contact within what it can hold', () => {
    createField({ key: 'n1', label: 'N1', type: 'text' })
    createField({ key: 'n2', label: 'N2', type: 'text' })
    db.mutate((data) => {
      data.contacts[1].custom = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`old${i}`, 'x'.repeat(490)]))
    })
    const out = writeCustomValues([{ email: 'b@x.co', values: { n1: 'x'.repeat(400) } }], { blanks: 'clear' })
    expect(out.updated).toBe(0)
    expect(out.problems[0].problem).toMatch(/more custom data/)
  })

  it('leaves a value whose option has gone until someone changes it', () => {
    editField('plan', { label: 'Plan', options: ['Free'] })
    expect(writeCustomValues([{ email: 'a@x.co', values: { plan: 'Pro', seats: 2 } }], { blanks: 'clear' }).problems).toEqual([])
    expect(db.data.contacts[0].custom).toEqual({ plan: 'Pro', seats: 2 })
  })
})

describe('fields', () => {
  it('stops at the limit', () => {
    for (let i = 0; i < 48; i++) createField({ key: `f${i}`, label: `F${i}`, type: 'text' })
    expect(() => createField({ key: 'last', label: 'Last', type: 'text' })).toThrow(/up to 50/)
  })

  it('validates an edit against the other fields, not itself', () => {
    expect(editField('seats', { label: 'seats' }).label).toBe('seats')
    expect(() => editField('seats', { label: 'Plan' })).toThrow(/already a field/)
    expect(() => editField('plan', { label: 'Plan', options: [] })).toThrow(/at least one/)
    expect(() => editField('nope', { label: 'Nope' })).toThrow(/not found/)
  })

  it('stays hidden unless a table asks for it, and is added after what that table shows', () => {
    expect(db.getContactColumns()).toEqual({})
    createField({ key: 'tier', label: 'Tier', type: 'text' }, { showIn: 'list' })
    expect(db.getContactColumns().list).toEqual(['contact', 'email', 'company', 'job_title', 'created_at', 'custom:tier'])
    expect(db.getContactColumns().contacts).toBeUndefined()
  })

  it('takes a deleted field out of the tables, so a new one with its key starts hidden', () => {
    createField({ key: 'tier', label: 'Tier', type: 'text' }, { showIn: 'contacts' })
    db.deleteContactField('tier')
    expect(db.getContactColumns().contacts).not.toContain('custom:tier')
  })
})
