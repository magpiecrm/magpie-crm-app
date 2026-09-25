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

export const CONTACT_FIELD_TYPES: ContactFieldType[] = ['text', 'number', 'date', 'boolean', 'select', 'multiselect']

/** Built-in contact columns, which custom keys may not shadow. */
const RESERVED_CONTACT_KEYS = ['email', 'first_name', 'last_name', 'job_title', 'company', 'status', 'created_at']

export const BUILTIN_FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  job_title: 'Job title',
  company: 'Company',
}

export function slugifyFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export function validateFieldKey(key: string): string | null {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return 'Key must start with a letter and use only a-z, 0-9 and _'
  if (RESERVED_CONTACT_KEYS.includes(key)) return `"${key}" is a built-in contact field`
  return null
}

export function formatCustomValue(value: ContactCustomValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}
