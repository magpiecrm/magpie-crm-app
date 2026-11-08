import { canonicalCountry } from '../../server/prospecting/geo'
import { HEADCOUNT_BUCKETS, SENIORITY_LABEL, SENIORITY_LEVELS } from '../../server/prospecting/types'
import { formatCustomValue, type ContactCustomValue, type ContactFieldDef } from './contactFields'

/**
 * Filters on contacts: which fields can be filtered on, the ways each kind of
 * field can be compared, and whether a contact passes. The Contacts page
 * filters in the browser, where it already has everyone, and shows what's left.
 * Building a list decides who gets email, so that goes through `selectForList`
 * on the server, which refuses a filter it can't apply rather than ignoring it.
 */

/** A contact as `contactsFn` / `listContactsFn` return it. */
export function contactForPage(r: any) {
  return {
    email: r.email as string,
    status: r.status as string,
    createdAt: r.created_at as string,
    attributes: {
      FIRSTNAME: r.first_name || '',
      LASTNAME: r.last_name || '',
      JOB_TITLE: r.job_title || '',
      COMPANY: r.company || '',
    },
    custom: (r.custom ?? {}) as Record<string, ContactCustomValue>,
    /** Their company record, for linking to it. */
    companyId: (r.company_id as string | null | undefined) ?? null,
    /** For contacts saved from prospect search: their LinkedIn profile, its country, where they came from and how sure the email is. */
    linkedinUrl: (r.linkedin_url as string | undefined) ?? '',
    country: (r.country as string | undefined) ?? '',
    source: (r.source as string | undefined) ?? '',
    emailStatus: (r.email_status as string | undefined) ?? '',
    /** The persona applied in the search that found them. */
    personaId: (r.persona_id as string | undefined) ?? '',
  }
}

/** The latest time something happened on an email to someone, and the latest email it could have. */
export interface Activity {
  last: string | null
  eligible: string | null
}

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
  personaId?: string
  /** Worked out on the server when building a list (listBuilder.ts). */
  seniority?: string
  companySize?: string
  industry?: string
  opened?: Activity
  clicked?: Activity
  replied?: Activity
}

export type FilterKind = 'text' | 'choice' | 'date' | 'number' | 'boolean' | 'activity'

export type FilterOp = 'contains' | 'not_contains' | 'contains_any' | 'contains_none' | 'is' | 'is_not' | 'is_any' | 'is_none' | 'empty' | 'not_empty' | 'on_or_after' | 'on_or_before' | 'more_than' | 'less_than' | 'yes' | 'no' | 'in_last_days' | 'not_in_last_days'

export interface FilterField {
  key: string
  label: string
  kind: FilterKind
  value: (contact: FilterableContact) => ContactCustomValue | undefined
  /** For a choice: the values to pick from, each with how it reads. */
  options?: Array<{ value: string; label: string }>
  /** For activity: what happened, in place of `value`. */
  activity?: (contact: FilterableContact) => Activity | undefined
  /** What to know before relying on it. */
  hint?: string
}

/** A field as the browser gets it, without the functions that read a contact. */
export type FilterFieldInfo = Pick<FilterField, 'key' | 'label' | 'kind' | 'options' | 'hint'>

export interface ContactFilter {
  id: string
  field: string
  op: FilterOp
  value: string
  /** What a `multi` comparison looks for, in place of `value`. */
  values?: string[]
}

/** The comparisons each kind of field offers; the first is what a new filter starts on. `valueless` ones need nothing typed, `multi` ones take several values. */
export const OPERATORS: Record<FilterKind, Array<{ op: FilterOp; label: string; valueless?: boolean; multi?: boolean }>> = {
  text: [
    { op: 'contains', label: 'contains' },
    { op: 'not_contains', label: "doesn't contain" },
    { op: 'is', label: 'is exactly' },
    { op: 'empty', label: 'is empty', valueless: true },
    { op: 'not_empty', label: 'has a value', valueless: true },
    { op: 'contains_any', label: 'has any of these words', multi: true },
    { op: 'contains_none', label: 'has none of these words', multi: true },
  ],
  choice: [
    { op: 'is', label: 'is' },
    { op: 'is_not', label: 'is not' },
    { op: 'empty', label: 'is empty', valueless: true },
    { op: 'not_empty', label: 'has a value', valueless: true },
    { op: 'is_any', label: 'is any of', multi: true },
    { op: 'is_none', label: 'is none of', multi: true },
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
  activity: [
    { op: 'in_last_days', label: 'in the last' },
    { op: 'not_in_last_days', label: 'not in the last' },
  ],
}

/** How far back an activity filter looks until it's changed, and how far it can. */
export const DEFAULT_ACTIVITY_DAYS = 90
const MAX_ACTIVITY_DAYS = 3650
const DAY_MS = 86_400_000

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

/** A persona's id and name, to show which one found someone. */
export type PersonaName = { id: string; name: string }

/** Everything the page can filter on: the built-in fields, then each custom one. */
export function filterFields(fieldDefs: ContactFieldDef[], contacts: FilterableContact[], personas: PersonaName[] = []): FilterField[] {
  const text = (key: string, label: string, value: FilterField['value']): FilterField => ({ key, label, kind: 'text', value })
  const choice = (key: string, label: string, value: FilterField['value'], labels?: Record<string, string>): FilterField => ({ key, label, kind: 'choice', value, options: optionsIn(contacts, value, labels) })
  return [
    text('email', 'Email', (c) => c.email),
    text('first_name', 'First name', (c) => c.attributes?.FIRSTNAME),
    text('last_name', 'Last name', (c) => c.attributes?.LASTNAME),
    text('job_title', 'Job title', (c) => c.attributes?.JOB_TITLE),
    text('company', 'Company', (c) => c.attributes?.COMPANY),
    // "UK" and "United Kingdom" are one country, however each contact came by it.
    choice('country', 'Country', (c) => canonicalCountry(c.country) ?? c.country),
    text('linkedin_url', 'LinkedIn URL', (c) => c.linkedinUrl),
    choice('status', 'Subscription', (c) => c.status, STATUS_LABELS),
    choice('email_status', 'Email check', (c) => c.emailStatus, EMAIL_STATUS_LABELS),
    choice('source', 'Found by', (c) => c.source, SOURCE_LABELS),
    choice('persona', 'Persona', (c) => c.personaId, Object.fromEntries(personas.map((p) => [p.id, p.name]))),
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

/**
 * What building a list can filter on besides the Contacts page's fields, which
 * need a pass over companies and sends the page doesn't make (listBuilder.ts).
 */
export function listFilterFields(fieldDefs: ContactFieldDef[], contacts: FilterableContact[], personas: PersonaName[] = []): FilterField[] {
  const all = filterFields(fieldDefs, contacts, personas)
  const builtIn = all.filter((f) => !f.key.startsWith('custom:'))
  const afterCompany = builtIn.findIndex((f) => f.key === 'company') + 1
  const happened = (key: 'opened' | 'clicked' | 'replied', label: string, hint: string): FilterField => ({ key, label, kind: 'activity', value: () => undefined, activity: (c) => c[key], hint })
  return [
    ...builtIn.slice(0, afterCompany),
    {
      key: 'seniority',
      label: 'Seniority',
      kind: 'choice',
      value: (c) => c.seniority,
      options: SENIORITY_LEVELS.map((level) => ({ value: level, label: SENIORITY_LABEL[level] })),
      hint: "Worked out from the job title, so it's a good guess rather than a fact.",
    },
    { key: 'company_size', label: 'Company size', kind: 'choice', value: (c) => c.companySize, options: HEADCOUNT_BUCKETS.map((b) => ({ value: b, label: b })), hint: 'Only companies whose staff count is known.' },
    { key: 'industry', label: 'Industry', kind: 'choice', value: (c) => c.industry, options: optionsIn(contacts, (c) => c.industry), hint: "Only companies with an industry typed in on the company's page." },
    ...builtIn.slice(afterCompany),
    happened('opened', 'Opened', 'A guide rather than a count: some mail apps load images by themselves. Automated opens are left out, and a click counts as an open.'),
    happened('clicked', 'Clicked', 'The first click on each email. Automated clicks are left out.'),
    happened('replied', 'Replied', "Replies to sequence emails, seen by a connected inbox or marked by hand. Replies to campaigns aren't tracked."),
    ...all.filter((f) => f.key.startsWith('custom:')),
  ]
}

/** A new filter on a field, on that kind's first comparison, or its first taking several values. */
export function newFilter(field: FilterFieldInfo, several = false): ContactFilter {
  const operators = OPERATORS[field.kind]
  const op = (several && operators.find((o) => o.multi)) || operators[0]
  return {
    id: `${field.key}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    field: field.key,
    op: op.op,
    value: field.kind === 'activity' ? String(DEFAULT_ACTIVITY_DAYS) : '',
    ...(op.multi ? { values: [] } : {}),
  }
}

const isBlank = (v: ContactCustomValue | undefined) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
/** The day a date falls on, as YYYY-MM-DD, or '' when it isn't one. */
const dayOf = (v: unknown) => {
  const date = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}

/** A `multi` filter's values, without the blanks. */
const valuesOf = (filter: ContactFilter) => (filter.values ?? []).map((v) => v.trim()).filter(Boolean)

const WORD_PATTERNS = new Map<string, RegExp>()

/**
 * A word or phrase as whole words, in any case, so "CTO" isn't found in
 * "Director". Bounded by letters and digits of any language, where `\b` only
 * knows English ones.
 */
function wordPattern(term: string): RegExp {
  const known = WORD_PATTERNS.get(term)
  if (known) return known
  const body = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu')
  if (WORD_PATTERNS.size >= 500) WORD_PATTERNS.clear()
  WORD_PATTERNS.set(term, pattern)
  return pattern
}

/** Whether a filter is ready to apply: one that still needs a value filters nothing out. */
export function isComplete(filter: ContactFilter, field: FilterFieldInfo | undefined): boolean {
  if (!field) return false
  const op = OPERATORS[field.kind].find((o) => o.op === filter.op)
  if (!op) return false
  if (op.multi) return valuesOf(filter).length > 0
  return Boolean(op.valueless || filter.value.trim() !== '')
}

export function matchesFilter(contact: FilterableContact, filter: ContactFilter, field: FilterField | undefined, now = Date.now()): boolean {
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
    case 'contains_any':
    case 'contains_none': {
      const text = String(Array.isArray(actual) ? actual.join(' ') : (actual ?? ''))
      const found = valuesOf(filter).some((term) => wordPattern(term).test(text))
      return filter.op === 'contains_any' ? found : !found
    }
    case 'is_any':
    case 'is_none': {
      const among = new Set(valuesOf(filter).map(lower))
      const found = Array.isArray(actual) ? actual.some((v) => among.has(lower(v))) : among.has(lower(actual))
      return filter.op === 'is_any' ? found : !found
    }
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
    case 'in_last_days':
    case 'not_in_last_days': {
      const since = new Date(now - Number(wanted) * DAY_MS).toISOString()
      const happened = field!.activity?.(contact)
      const recent = Boolean(happened?.last && happened.last >= since)
      if (filter.op === 'in_last_days') return recent
      // Not happening only says something about someone who had an email it could happen on.
      return !recent && Boolean(happened?.eligible && happened.eligible >= since)
    }
  }
}

/** The contacts that pass every filter. */
export function applyFilters<C extends FilterableContact>(contacts: C[], filters: ContactFilter[], fields: FilterField[]): C[] {
  const active = filters.map((f) => ({ f, field: fields.find((x) => x.key === f.field) })).filter(({ f, field }) => isComplete(f, field))
  if (!active.length) return contacts
  return contacts.filter((c) => active.every(({ f, field }) => matchesFilter(c, f, field)))
}

export interface ContactSort {
  column: string
  dir: 'asc' | 'desc'
}

/** What a column sorts on: a number, or text. Null sits last whichever way it's sorted. */
function sortKey(contact: FilterableContact, column: string, defs: ContactFieldDef[]): string | number | null {
  const given = (v: string | undefined) => v?.trim() || null
  switch (column) {
    case 'contact':
      return `${contact.attributes?.FIRSTNAME ?? ''} ${contact.attributes?.LASTNAME ?? ''}`.trim() || contact.email
    case 'email':
      return contact.email
    case 'status':
      return given(contact.status)
    case 'company':
      return given(contact.attributes?.COMPANY)
    case 'job_title':
      return given(contact.attributes?.JOB_TITLE)
    case 'country':
      return given(contact.country)
    case 'created_at':
      return given(contact.createdAt)
  }
  const key = column.replace(/^custom:/, '')
  const value = contact.custom?.[key]
  if (isBlank(value)) return null
  const type = defs.find((d) => d.key === key)?.type
  if (type === 'number') return Number.isFinite(Number(value)) ? Number(value) : null
  if (type === 'boolean') return value === true ? 1 : 0
  return formatCustomValue(value)
}

/** Contacts in a column's order, with anyone blank last either way. */
export function sortContacts<C extends FilterableContact>(contacts: C[], sort: ContactSort | null, defs: ContactFieldDef[]): C[] {
  if (!sort) return contacts
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const way = sort.dir === 'asc' ? 1 : -1
  return contacts
    .map((contact) => ({ contact, key: sortKey(contact, sort.column, defs) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === b.key ? 0 : a.key === null ? 1 : -1
      if (typeof a.key === 'number' && typeof b.key === 'number') return (a.key - b.key) * way
      return collator.compare(String(a.key), String(b.key)) * way
    })
    .map(({ contact }) => contact)
}

/** Everything a search looks through for a contact, in lower case. */
export function contactSearchText(contact: FilterableContact): string {
  const { FIRSTNAME, LASTNAME, COMPANY, JOB_TITLE } = contact.attributes ?? {}
  return [contact.email, FIRSTNAME, LASTNAME, COMPANY, JOB_TITLE, contact.country, ...Object.values(contact.custom ?? {}).map(formatCustomValue)]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

/** A filter saved on a list, with its field's name in case the field goes. */
export type SavedFilter = ContactFilter & { label: string }

const validValue = (field: FilterFieldInfo, value: string) => {
  const v = value.trim()
  if (field.kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v) && dayOf(v) === v
  if (field.kind === 'number') return Number.isFinite(Number(v))
  if (field.kind === 'activity') return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= MAX_ACTIVITY_DAYS
  return true
}

/**
 * What stops these filters being used to pick people, each said for the user.
 * Where the page ignores a filter it can't apply, this refuses, as leaving one
 * out would pick more people than were asked for.
 */
export function filterProblems(filters: Array<ContactFilter & { label?: string }>, fields: FilterFieldInfo[]): string[] {
  if (filters.length === 0) return ['Add at least one filter.']
  return filters.flatMap((filter) => {
    const field = fields.find((f) => f.key === filter.field)
    if (!field) return [`The "${filter.label ?? filter.field}" field doesn't exist any more.`]
    const op = OPERATORS[field.kind].find((o) => o.op === filter.op)
    if (!op) return [`${field.label} can't be compared that way.`]
    if (!isComplete(filter, field)) return [`${field.label} still needs a value.`]
    if (!op.valueless && !op.multi && !validValue(field, filter.value)) {
      return [field.kind === 'activity' ? `${field.label} needs a number of days, from 1 to ${MAX_ACTIVITY_DAYS}.` : `${field.label} needs a valid ${field.kind}.`]
    }
    return []
  })
}

/** The contacts that pass every filter, or an error when one can't be applied: never everyone by mistake. */
export function selectForList<C extends FilterableContact>(contacts: C[], filters: ContactFilter[], fields: FilterField[], now = Date.now()): C[] {
  const [problem] = filterProblems(filters, fields)
  if (problem) throw new Error(problem)
  const active = filters.map((filter) => ({ filter, field: fields.find((f) => f.key === filter.field)! }))
  return contacts.filter((c) => active.every(({ filter, field }) => matchesFilter(c, filter, field, now)))
}

const LEAVES_OUT: FilterOp[] = ['not_contains', 'contains_none', 'is_not', 'is_none']
const ABOUT_BLANKS: FilterOp[] = ['empty', 'not_empty', 'yes', 'no']

/**
 * How many have nothing in a filter's field, which decides whether they're
 * picked: left out of "is Germany", and in "is not Germany".
 */
export function blanksIn(contacts: FilterableContact[], matched: FilterableContact[], filters: ContactFilter[], fields: FilterField[]) {
  return filters.flatMap((filter) => {
    const field = fields.find((f) => f.key === filter.field)
    if (!field || field.kind === 'activity' || ABOUT_BLANKS.includes(filter.op)) return []
    const included = LEAVES_OUT.includes(filter.op)
    const count = (included ? matched : contacts).filter((c) => isBlank(field.value(c))).length
    return count ? [{ label: field.label, count, included }] : []
  })
}

/** A saved filter as a line of plain words. */
export function describeFilter(filter: SavedFilter, field?: FilterFieldInfo): string {
  const op = Object.values(OPERATORS).flat().find((o) => o.op === filter.op)
  const shown = (value: string) => field?.options?.find((o) => o.value === value)?.label ?? value
  if (op?.multi) return `${filter.label} ${op.label}: ${(filter.values ?? []).map(shown).join(', ')}`
  if (op?.valueless) return `${filter.label} ${op.label}`
  return `${filter.label} ${op?.label ?? filter.op} ${shown(filter.value)}${filter.op.endsWith('_days') ? ' days' : ''}`
}
