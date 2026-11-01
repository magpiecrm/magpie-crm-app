/**
 * Custom contact fields: user-defined attributes stored on `contacts[].custom`,
 * keyed by an immutable slug. Surveys write to them via question mappings.
 */

export type ContactFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect'

export interface ContactFieldDef {
  /** Immutable slug, `[a-z0-9_]`. Renaming changes the label only. */
  key: string
  label: string
  type: ContactFieldType
  /** Allowed values for select / multiselect. */
  options?: string[]
  created_at: string
}

export type ContactCustomValue = string | number | boolean | string[] | null

/** The two tables of contacts: the Contacts page and a list's page. They start with different columns. */
export type ContactTableView = 'contacts' | 'list'

export const CONTACT_FIELD_TYPES: ContactFieldType[] = ['text', 'number', 'date', 'boolean', 'select', 'multiselect']

export const TYPE_LABELS: Record<ContactFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / No',
  select: 'Single select',
  multiselect: 'Multi select',
}

export const hasOptions = (type: ContactFieldType) => type === 'select' || type === 'multiselect'

export const parseOptions = (raw: string) =>
  raw
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

/** Checked when something is written; what's already saved is never refused on reading. */
export const FIELD_LIMITS = {
  fields: 50,
  labelLength: 80,
  options: 100,
  optionLength: 80,
  textValue: 500,
  /** A contact's custom values together, as JSON. */
  customJson: 4000,
  visibleColumns: 20,
}

/** Built-in contact columns, which custom keys may not shadow. `constructor` would read a function off the values. */
const RESERVED_CONTACT_KEYS = ['email', 'first_name', 'last_name', 'job_title', 'company', 'status', 'created_at', 'constructor']

/** The headers of an export's standard columns (exportColumns.ts): a custom field called one of these couldn't be told apart coming back in. */
export const BUILTIN_EXPORT_HEADERS = ['Email', 'First Name', 'Last Name', 'Job Title', 'Company', 'Country', 'LinkedIn URL', 'Status', 'Created At']

export const BUILTIN_FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  job_title: 'Job title',
  company: 'Company',
}

export function slugifyFieldKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  // A key starts with a letter, so "2024 spend" still gets one.
  return (/^\d/.test(slug) ? `field_${slug}` : slug).slice(0, 40)
}

export function validateFieldKey(key: string): string | null {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return 'Key must start with a letter and use only a-z, 0-9 and _'
  if (RESERVED_CONTACT_KEYS.includes(key)) return `"${key}" is a built-in contact field`
  return null
}

/** What's wrong with a field's label and options, or null. `others` are the workspace's other fields. */
export function fieldProblem(field: Pick<ContactFieldDef, 'label' | 'type' | 'options'>, others: ContactFieldDef[]): string | null {
  const label = field.label.trim()
  if (!label) return 'Give it a name.'
  if (label.length > FIELD_LIMITS.labelLength) return `Names can be up to ${FIELD_LIMITS.labelLength} characters.`
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  if (BUILTIN_EXPORT_HEADERS.some(h => same(h, label))) return `"${label}" is already a standard column.`
  if (others.some(f => same(f.label, label))) return `There's already a field called "${label}".`
  if (!hasOptions(field.type)) return null
  const options = field.options ?? []
  if (options.length === 0) return 'Add at least one option.'
  if (options.length > FIELD_LIMITS.options) return `A field can have up to ${FIELD_LIMITS.options} options.`
  if (options.some(o => !o.trim() || o.length > FIELD_LIMITS.optionLength || o.includes(','))) return `Options need text, up to ${FIELD_LIMITS.optionLength} characters, with no commas.`
  if (new Set(options.map(o => o.toLowerCase())).size !== options.length) return 'Each option can only appear once.'
  return null
}

export type CoercedValue = { ok: true; value: ContactCustomValue } | { ok: false; problem: string }

const isRealDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A value as a field stores it, from what was typed, imported or sent: `null`
 * for nothing. `current` is what the contact has now, which stands even if the
 * field has since changed, like a choice that's been removed from its options.
 */
export function coerceCustomValue(raw: unknown, def: ContactFieldDef, opts: { current?: ContactCustomValue } = {}): CoercedValue {
  const text = typeof raw === 'string' ? raw.trim() : raw
  if (text === undefined || text === null || text === '' || (Array.isArray(text) && text.length === 0)) return { ok: true, value: null }
  if (opts.current !== undefined && sameValue(text, opts.current)) return { ok: true, value: opts.current }
  const refuse = (problem: string): CoercedValue => ({ ok: false, problem })
  const options = def.options ?? []
  const option = (value: string) => options.find(o => o.toLowerCase() === value.trim().toLowerCase())

  switch (def.type) {
    case 'text': {
      if (typeof text === 'object') return refuse(`${def.label} needs text.`)
      const value = String(text)
      return value.length > FIELD_LIMITS.textValue ? refuse(`${def.label} can be up to ${FIELD_LIMITS.textValue} characters.`) : { ok: true, value }
    }
    case 'number': {
      if (typeof text === 'number') return Number.isFinite(text) ? { ok: true, value: text } : refuse(`${def.label} needs a number.`)
      if (typeof text !== 'string' || !/^[+-]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(text)) return refuse(`${def.label} needs a number.`)
      return { ok: true, value: Number(text.replace(/,/g, '')) }
    }
    case 'date': {
      const day = typeof text === 'string' ? /^(\d{4}-\d{2}-\d{2})(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text)?.[1] : undefined
      return day && isRealDay(day) ? { ok: true, value: day } : refuse(`${def.label} needs a date like 2026-03-31.`)
    }
    case 'boolean': {
      if (typeof text === 'boolean') return { ok: true, value: text }
      const word = String(text).toLowerCase()
      if (['yes', 'y', 'true', '1'].includes(word)) return { ok: true, value: true }
      if (['no', 'n', 'false', '0'].includes(word)) return { ok: true, value: false }
      return refuse(`${def.label} needs yes or no.`)
    }
    case 'select': {
      const value = typeof text === 'string' ? option(text) : undefined
      return value ? { ok: true, value } : refuse(`${def.label} needs one of its options.`)
    }
    case 'multiselect': {
      const whole = typeof text === 'string' ? option(text) : undefined
      const asked = whole ? [whole] : Array.isArray(text) ? text.map(String) : String(text).split(',')
      const had = Array.isArray(opts.current) ? opts.current : []
      const values = asked.map(v => v.trim()).filter(Boolean).map(v => option(v) ?? had.find(h => h.toLowerCase() === v.toLowerCase()))
      if (values.some(v => v === undefined)) return refuse(`${def.label} needs values from its options.`)
      return { ok: true, value: [...new Set(values as string[])] }
    }
  }
}

export function formatCustomValue(value: ContactCustomValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}
