import type { ContactCustomValue, ContactFieldDef } from './contactFields'

/**
 * Filters for the Contacts page: which fields can be filtered on, the ways
 * each kind of field can be compared, and whether a contact passes. Contacts
 * are filtered in the browser, where the page already has all of them.
 */

/** A contact as `contactsFn` / `listContactsFn` return it (`contactForPage` in emailService.ts). */
export interface FilterableContact {
  email: string
  status?: string
  createdAt?: string
  attributes?: { FIRSTNAME?: string; LASTNAME?: string; JOB_TITLE?: string; COMPANY?: string }
  custom?: Record<string, ContactCustomValue>
  linkedinUrl?: string
  country?: string
  source?: string
  emailStatus?: string
}

export type FilterKind = 'text' | 'choice' | 'date' | 'number' | 'boolean'

export type FilterOp = 'contains' | 'not_contains' | 'is' | 'is_not' | 'empty' | 'not_empty' | 'on_or_after' | 'on_or_before' | 'more_than' | 'less_than' | 'yes' | 'no'

export interface FilterField {
  key: string
  label: string
  kind: FilterKind
  value: (contact: FilterableContact) => ContactCustomValue | undefined
  /** For a choice: the values to pick from, each with how it reads. */
  options?: Array<{ value: string; label: string }>
}

export interface ContactFilter {
  id: string
  field: string
  op: FilterOp
  value: string
}

/** The comparisons each kind of field offers; the first is what a new filter starts on. `valueless` ones need nothing typed. */
export const OPERATORS: Record<FilterKind, Array<{ op: FilterOp; label: string; valueless?: boolean }>> = {
  text: [
    { op: 'contains', label: 'contains' },
    { op: 'not_contains', label: "doesn't contain" },
    { op: 'is', label: 'is exactly' },
    { op: 'empty', label: 'is empty', valueless: true },
    { op: 'not_empty', label: 'has a value', valueless: true },
  ],
  choice: [
    { op: 'is', label: 'is' },
    { op: 'is_not', label: 'is not' },
    { op: 'empty', label: 'is empty', valueless: true },
    { op: 'not_empty', label: 'has a value', valueless: true },
  ],
  date: [
    { op: 'on_or_after', label: 'on or after' },
    { op: 'on_or_before', label: 'on or before' },
    { op: 'empty', label: 'is empty', valueless: true },
  ],
  number: [
    { op: 'is', label: 'is' },
    { op: 'more_than', label: 'is more than' },
    { op: 'less_than', label: 'is less than' },
    { op: 'empty', label: 'is empty', valueless: true },
  ],
  boolean: [
    { op: 'yes', label: 'is yes', valueless: true },
    { op: 'no', label: 'is no', valueless: true },
  ],
}

const STATUS_LABELS: Record<string, string> = { subscribed: 'Subscribed', unsubscribed: 'Unsubscribed', bounced: 'Bounced', blocklisted: 'Blocklisted', pending: 'Pending' }
const EMAIL_STATUS_LABELS: Record<string, string> = {
  verified: 'Verified',
  format_confirmed: 'Format confirmed',
  catch_all_likely: 'Likely (accepts every address)',
  risky: 'Risky',
  unverified: 'Unverified',
}
const SOURCE_LABELS: Record<string, string> = { socialfetch: 'Prospect search', shared: 'Shared database' }

const titled = (value: string) => value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The values a choice field has among these contacts, most common first, with a label for each. */
function optionsIn(contacts: FilterableContact[], value: FilterField['value'], labels: Record<string, string> = {}): FilterField['options'] {
  const counts = new Map<string, number>()
  for (const c of contacts) {
    const v = value(c)
    if (typeof v === 'string' && v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => ({ value: v, label: labels[v] ?? titled(v) }))
}

const KIND_OF: Record<ContactFieldDef['type'], FilterKind> = { text: 'text', number: 'number', date: 'date', boolean: 'boolean', select: 'choice', multiselect: 'choice' }

/** Everything the page can filter on: the built-in fields, then each custom one. */
export function filterFields(fieldDefs: ContactFieldDef[], contacts: FilterableContact[]): FilterField[] {
  const text = (key: string, label: string, value: FilterField['value']): FilterField => ({ key, label, kind: 'text', value })
  const choice = (key: string, label: string, value: FilterField['value'], labels?: Record<string, string>): FilterField => ({ key, label, kind: 'choice', value, options: optionsIn(contacts, value, labels) })
  return [
    text('email', 'Email', (c) => c.email),
    text('first_name', 'First name', (c) => c.attributes?.FIRSTNAME),
    text('last_name', 'Last name', (c) => c.attributes?.LASTNAME),
    text('job_title', 'Job title', (c) => c.attributes?.JOB_TITLE),
    text('company', 'Company', (c) => c.attributes?.COMPANY),
    choice('country', 'Country', (c) => c.country),
    text('linkedin_url', 'LinkedIn URL', (c) => c.linkedinUrl),
    choice('status', 'Subscription', (c) => c.status, STATUS_LABELS),
    choice('email_status', 'Email check', (c) => c.emailStatus, EMAIL_STATUS_LABELS),
    choice('source', 'Found by', (c) => c.source, SOURCE_LABELS),
    { key: 'created_at', label: 'Date added', kind: 'date', value: (c) => c.createdAt },
    ...fieldDefs.map((def): FilterField => ({
      key: `custom:${def.key}`,
      label: def.label,
      kind: KIND_OF[def.type],
      value: (c) => c.custom?.[def.key],
      options: def.options?.map((o) => ({ value: o, label: o })),
    })),
  ]
}

/** A new filter on a field, on that kind's first comparison. */
export function newFilter(field: FilterField): ContactFilter {
  return { id: `${field.key}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, field: field.key, op: OPERATORS[field.kind][0].op, value: '' }
}

const isBlank = (v: ContactCustomValue | undefined) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
/** The day a date falls on, as YYYY-MM-DD, or '' when it isn't one. */
const dayOf = (v: unknown) => {
  const date = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}

/** Whether a filter is ready to apply: one that still needs a value filters nothing out. */
export function isComplete(filter: ContactFilter, field: FilterField | undefined): boolean {
  if (!field) return false
  const op = OPERATORS[field.kind].find((o) => o.op === filter.op)
  return Boolean(op && (op.valueless || filter.value.trim() !== ''))
}

export function matchesFilter(contact: FilterableContact, filter: ContactFilter, field: FilterField | undefined): boolean {
  if (!isComplete(filter, field)) return true
  const actual = field!.value(contact)
  const wanted = filter.value.trim()
  switch (filter.op) {
    case 'empty':
      return isBlank(actual)
    case 'not_empty':
      return !isBlank(actual)
    case 'yes':
      return actual === true
    case 'no':
      return actual !== true
    case 'contains':
      return lower(Array.isArray(actual) ? actual.join(' ') : actual).includes(wanted.toLowerCase())
    case 'not_contains':
      return !lower(Array.isArray(actual) ? actual.join(' ') : actual).includes(wanted.toLowerCase())
    case 'is':
      if (field!.kind === 'number') return !isBlank(actual) && Number(actual) === Number(wanted)
      return Array.isArray(actual) ? actual.some((v) => lower(v) === wanted.toLowerCase()) : lower(actual) === wanted.toLowerCase()
    case 'is_not':
      return Array.isArray(actual) ? !actual.some((v) => lower(v) === wanted.toLowerCase()) : lower(actual) !== wanted.toLowerCase()
    case 'on_or_after':
      return dayOf(actual) !== '' && dayOf(actual) >= wanted
    case 'on_or_before':
      return dayOf(actual) !== '' && dayOf(actual) <= wanted
    case 'more_than':
      return !isBlank(actual) && Number(actual) > Number(wanted)
    case 'less_than':
      return !isBlank(actual) && Number(actual) < Number(wanted)
  }
}

/** The contacts that pass every filter. */
export function applyFilters<C extends FilterableContact>(contacts: C[], filters: ContactFilter[], fields: FilterField[]): C[] {
  const active = filters.map((f) => ({ f, field: fields.find((x) => x.key === f.field) })).filter(({ f, field }) => isComplete(f, field))
  if (!active.length) return contacts
  return contacts.filter((c) => active.every(({ f, field }) => matchesFilter(c, f, field)))
}
