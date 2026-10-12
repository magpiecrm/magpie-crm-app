// Contact merge tags in an email's subject and body, for campaigns, test
// sends and sequences: {{ contact.first_name }} (or FIRSTNAME), last_name
// (LASTNAME), COMPANY, EMAIL and {{ contact.custom.<key> }}. A tag can give a
// fallback for an empty value: {{ contact.first_name | default: "there" }}.
// The fallback's quote marks are taken however they arrive: the email builder
// writes them into HTML as &quot;, and people paste curly ones. A contact tag
// that isn't one of ours is left as it is, and a campaign with one isn't sent
// (unfilledMergeTags), rather than going out with the tag showing.

import { formatCustomValue } from '../features/contacts/contactFields'

export interface MergeContact {
  email: string
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  custom?: Record<string, unknown> | null
}

/** A quote mark, plain or curly, as typed or as HTML writes it. */
const QUOTE = String.raw`(?:"|'|&quot;|&apos;|&#0*3[49];|&#x0*2[27];|&[lr][sd]quo;|[\u201C\u201D\u2018\u2019])`
/** Space inside a tag, including the non-breaking kind an editor can leave there. */
const GAP = String.raw`(?:\s|&nbsp;|\u00A0)*`
const TAG = new RegExp(String.raw`\{\{${GAP}contact\.(custom\.[a-z0-9_]+|[a-z_]+)${GAP}(?:\|${GAP}default:${GAP}${QUOTE}([^{}]*?)${QUOTE}${GAP})?\}\}`, 'gi')
/** Anything written as a contact tag, whether or not it's one we can fill. */
const ANY_CONTACT_TAG = /\{\{[^{}]*\bcontact\.[^{}]*\}\}/gi

const unescapeHtml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#0*39|#0*34);/gi, (_all, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e.toLowerCase()] ?? (/34$/.test(e) ? '"' : "'"))

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
    // A fallback written into HTML is already HTML: read it back to text first, so it's escaped once like any value.
    const shown = value.trim() ? value : opts.html ? unescapeHtml(fallback ?? '') : (fallback ?? '')
    return opts.html ? escapeHtml(shown) : shown
  })
}

/**
 * Contact tags in `text` that merging would leave showing: a field we don't
 * have ({{ contact.job_title }}), or a tag written some way we can't read.
 * For refusing to send a campaign with one in it.
 */
export function unfilledMergeTags(text: string): string[] {
  const left = new Set<string>()
  for (const m of text.matchAll(ANY_CONTACT_TAG)) {
    TAG.lastIndex = 0
    const read = TAG.exec(m[0])
    if (!read || read[0] !== m[0] || valueOf(read[1], { email: '' }) === undefined) left.add(m[0].replace(/&quot;/g, '"').replace(/&nbsp;/g, ' '))
  }
  TAG.lastIndex = 0
  return [...left]
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
