import { describe, expect, it } from 'vitest'
import { applyFilters, filterFields, isComplete, newFilter, type ContactFilter, type FilterableContact } from './contactFilters'
import type { ContactFieldDef } from './contactFields'

const contacts: FilterableContact[] = [
  { email: 'ana@acme.com', status: 'subscribed', createdAt: '2026-10-01T09:00:00Z', attributes: { FIRSTNAME: 'Ana', LASTNAME: 'Lopez', JOB_TITLE: 'Founder', COMPANY: 'Acme Ltd' }, country: 'United Kingdom', linkedinUrl: 'https://www.linkedin.com/in/ana', source: 'socialfetch', emailStatus: 'verified', custom: { seats: 12, vip: true, plan: 'Pro' } },
  { email: 'ben@globex.com', status: 'unsubscribed', createdAt: '2026-10-05T09:00:00Z', attributes: { FIRSTNAME: 'Ben', LASTNAME: 'Smith', JOB_TITLE: 'Head of Sales', COMPANY: 'Globex' }, country: 'Germany', source: 'socialfetch', emailStatus: 'format_confirmed', custom: { seats: 3, plan: 'Free' } },
  { email: 'cat@initech.com', status: 'subscribed', createdAt: '2026-10-09T09:00:00Z', attributes: { FIRSTNAME: 'Cat', COMPANY: 'Initech' }, custom: {} },
]
const defs: ContactFieldDef[] = [
  { key: 'seats', label: 'Seats', type: 'number', created_at: '' },
  { key: 'vip', label: 'VIP', type: 'boolean', created_at: '' },
  { key: 'plan', label: 'Plan', type: 'select', options: ['Free', 'Pro'], created_at: '' },
]
const fields = filterFields(defs, contacts)
const f = (field: string, op: ContactFilter['op'], value = ''): ContactFilter => ({ id: field + op, field, op, value })
const emails = (...filters: ContactFilter[]) => applyFilters(contacts, filters, fields).map((c) => c.email.split('@')[0])
const many = (field: string, op: ContactFilter['op'], ...values: string[]): ContactFilter => ({ id: field + op, field, op, value: '', values })
/** Whether a person with this job title is found by looking for a word. */
const titled = (title: string, word: string) => applyFilters([{ email: 'a@a.test', attributes: { JOB_TITLE: title } }], [many('job_title', 'contains_any', word)], fields).length === 1

describe('contact filters', () => {
  it('filters text by what it contains, exactly, or whether there is any', () => {
    expect(emails(f('company', 'contains', 'acme'))).toEqual(['ana'])
    expect(emails(f('company', 'not_contains', 'ACME'))).toEqual(['ben', 'cat'])
    expect(emails(f('job_title', 'is', 'founder'))).toEqual(['ana'])
    expect(emails(f('job_title', 'empty'))).toEqual(['cat'])
    expect(emails(f('linkedin_url', 'not_empty'))).toEqual(['ana'])
  })

  it('offers the values a choice field has among the contacts, and filters on one', () => {
    expect(fields.find((x) => x.key === 'country')!.options).toEqual([{ value: 'Germany', label: 'Germany' }, { value: 'United Kingdom', label: 'United Kingdom' }])
    expect(fields.find((x) => x.key === 'source')!.options).toEqual([{ value: 'socialfetch', label: 'Prospect search' }])
    expect(fields.find((x) => x.key === 'email_status')!.options!.map((o) => o.label)).toEqual(['Format confirmed', 'Verified'])
    expect(emails(f('country', 'is', 'Germany'))).toEqual(['ben'])
    expect(emails(f('country', 'is_not', 'Germany'))).toEqual(['ana', 'cat'])
    expect(emails(f('status', 'is', 'subscribed'))).toEqual(['ana', 'cat'])
    expect(emails(f('source', 'empty'))).toEqual(['cat'])
  })

  it('filters dates by day, numbers by size and yes/no fields', () => {
    expect(emails(f('created_at', 'on_or_after', '2026-10-05'))).toEqual(['ben', 'cat'])
    expect(emails(f('created_at', 'on_or_before', '2026-10-05'))).toEqual(['ana', 'ben'])
    expect(emails(f('custom:seats', 'more_than', '5'))).toEqual(['ana'])
    expect(emails(f('custom:seats', 'less_than', '5'))).toEqual(['ben'])
    expect(emails(f('custom:seats', 'empty'))).toEqual(['cat'])
    expect(emails(f('custom:vip', 'yes'))).toEqual(['ana'])
    expect(emails(f('custom:vip', 'no'))).toEqual(['ben', 'cat'])
    expect(emails(f('custom:plan', 'is', 'Pro'))).toEqual(['ana'])
  })

  it('needs every filter to pass, and ignores one still waiting for a value', () => {
    expect(emails(f('status', 'is', 'subscribed'), f('country', 'is', 'United Kingdom'))).toEqual(['ana'])
    expect(emails(f('company', 'contains', ''))).toEqual(['ana', 'ben', 'cat'])
    expect(emails(f('nothing', 'contains', 'x'))).toEqual(['ana', 'ben', 'cat'])
    const started = newFilter(fields.find((x) => x.key === 'company')!)
    expect(started).toMatchObject({ field: 'company', op: 'contains', value: '' })
    expect(isComplete(started, fields.find((x) => x.key === 'company'))).toBe(false)
  })

  it("finds any of several values, which filters needing every one to pass can't", () => {
    expect(emails(many('country', 'is_any', 'Germany', 'United Kingdom'))).toEqual(['ana', 'ben'])
    expect(emails(many('job_title', 'contains_any', 'Founder', 'Head of Sales'))).toEqual(['ana', 'ben'])
    expect(emails(many('custom:plan', 'is_any', 'Free'))).toEqual(['ben'])
  })

  it('leaves out any of several values, keeping blanks as the other negative filters do', () => {
    expect(emails(many('country', 'is_none', 'Germany'))).toEqual(['ana', 'cat'])
    expect(emails(many('job_title', 'contains_none', 'Founder'))).toEqual(['ben', 'cat'])
  })

  it('looks for whole words, where "contains" finds them inside others', () => {
    expect(titled('Director of Sales', 'CTO')).toBe(false)
    expect(titled('CTO', 'cto')).toBe(true)
    expect(titled('CTO & Co-Founder', 'CTO')).toBe(true)
    expect(titled('Coordinator', 'COO')).toBe(false)
    expect(titled('International Sales', 'Intern')).toBe(false)
    expect(titled('Sales Intern', 'Intern')).toBe(true)
    expect(titled('Head  of   Sales', 'head of sales')).toBe(true)
    expect(titled('Gérant', 'Géran')).toBe(false)
  })

  it("takes what's typed literally", () => {
    expect(titled('C++ Developer', 'C++')).toBe(true)
    expect(titled('Developer', '.*')).toBe(false)
    expect(titled('Founder', '(')).toBe(false)
  })

  it('waits for at least one value, and ignores blank ones', () => {
    const field = fields.find((x) => x.key === 'country')
    expect(isComplete(many('country', 'is_any'), field)).toBe(false)
    expect(isComplete(many('country', 'is_any', '  '), field)).toBe(false)
    expect(isComplete({ ...many('country', 'is_any'), value: 'Germany' }, field)).toBe(false)
    expect(isComplete(many('country', 'is_any', 'Germany'), field)).toBe(true)
    expect(emails(many('country', 'is_any'))).toEqual(['ana', 'ben', 'cat'])
  })

  it('counts every spelling of a country as one', () => {
    const spellings: FilterableContact[] = [{ email: 'a@a.test', country: 'UK' }, { email: 'b@b.test', country: 'United Kingdom' }, { email: 'c@c.test', country: 'London' }, { email: 'd@d.test', country: 'Atlantis' }, { email: 'e@e.test' }]
    const spelled = filterFields([], spellings)
    expect(spelled.find((x) => x.key === 'country')!.options).toEqual([{ value: 'United Kingdom', label: 'United Kingdom' }, { value: 'Atlantis', label: 'Atlantis' }])
    expect(applyFilters(spellings, [f('country', 'is', 'United Kingdom')], spelled).map((c) => c.email[0])).toEqual(['a', 'b', 'c'])
  })

  it('starts a filter where it always did', () => {
    const starts: Record<string, string> = { company: 'contains', country: 'is', created_at: 'on_or_after', 'custom:seats': 'is', 'custom:vip': 'yes' }
    for (const [key, op] of Object.entries(starts)) expect(newFilter(fields.find((x) => x.key === key)!).op).toBe(op)
  })
})
