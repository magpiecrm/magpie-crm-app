// Contact merge tags in an email's subject and body, for campaigns, test
// sends and sequences: {{ contact.first_name }} (or FIRSTNAME), last_name
// (LASTNAME), COMPANY, EMAIL and {{ contact.custom.<key> }}. A tag can give a
// fallback for an empty value: {{ contact.first_name | default: "there" }}.
// Unknown tags are left as they are.

import { formatCustomValue } from '../features/contacts/contactFields'

export interface MergeContact {
  email: string
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  custom?: Record<string, unknown> | null
}

const TAG = /\{\{\s*contact\.(custom\.[a-z0-9_]+|[a-z_]+)\s*(?:\|\s*default:\s*"([^"]*)"\s*)?\}\}/gi

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!)

/** A tag's value for the contact, or undefined for a tag that isn't one of ours. */
function valueOf(key: string, contact: MergeContact, customFallback?: (key: string) => string): string | undefined {
  if (/^custom\./i.test(key)) {
    const field = key.slice('custom.'.length)
    return formatCustomValue(contact.custom?.[field] as any) || customFallback?.(field) || ''
  }
  switch (key.toLowerCase()) {
    case 'first_name':
    case 'firstname':
      return contact.first_name ?? ''
    case 'last_name':
    case 'lastname':
      return contact.last_name ?? ''
    case 'company':
      return contact.company ?? ''
    case 'email':
      return contact.email
    default:
      return undefined
  }
}

/**
 * Fills in the contact's merge tags. `html` escapes the values (the subject
 * and a plain-text part aren't escaped). `customFallback` stands in for an
 * empty custom field (test sends show "Test<key>").
 */
export function mergeContact(text: string, contact: MergeContact, opts: { html: boolean; customFallback?: (key: string) => string }): string {
  if (!text) return text
  return text.replace(TAG, (tag: string, key: string, fallback?: string) => {
    const value = valueOf(key, contact, opts.customFallback)
    if (value === undefined) return tag
    const shown = value.trim() ? value : (fallback ?? '')
    return opts.html ? escapeHtml(shown) : shown
  })
}

/** The merge tags in `text` that would come out empty for a contact (for a preview's warnings). */
export function emptyMergeTags(text: string, contact: MergeContact): string[] {
  const empty = new Set<string>()
  for (const m of text.matchAll(TAG)) {
    const value = valueOf(m[1], contact)
    if (value !== undefined && !value.trim() && m[2] === undefined) empty.add(m[1])
  }
  return [...empty]
}
