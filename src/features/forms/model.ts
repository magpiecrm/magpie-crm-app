import { coerceCustomValue, type ContactCustomValue, type ContactFieldDef } from '../contacts/contactFields'

/**
 * Forms: a website's contact or sign-up form. What's stored is small (which
 * fields, in what order, with any label or required changed from the default);
 * everything here turns that into the fields a page draws and checks what a
 * visitor sent against them. Shared by the builder's preview, the hosted page
 * and the submit route, so all three agree.
 */

/**
 * Built-in fields. Email is always on the form; message and consent are kept
 * with the submission, not on the contact.
 */
export const BUILTIN_FORM_FIELDS = ['first_name', 'last_name', 'email', 'company', 'job_title', 'message', 'consent'] as const
export type BuiltinFormField = (typeof BUILTIN_FORM_FIELDS)[number]

export const BUILTIN_LABELS: Record<BuiltinFormField, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  company: 'Company',
  job_title: 'Job title',
  message: 'Message',
  consent: 'Consent',
}

/** The consent box's wording until it's changed. */
const DEFAULT_CONSENT_TEXT = 'I agree to receive emails. I can unsubscribe at any time.'

export interface FormFieldSettings {
  label?: string
  required?: boolean
  placeholder?: string
  /** A line under the label: what to put, or why it's asked. */
  help?: string
  /** Not shown: filled from the page's address (`?param=…`), for a custom field such as where someone came from. */
  hidden?: boolean
  /** The address's parameter it's filled from. Its key when not set. */
  param?: string
}

export type FormCorners = 'square' | 'rounded' | 'pill'

export interface FormStyle {
  /** The button's colour, `#rrggbb`. */
  accent?: string
  corners?: FormCorners
  /** For a light or a dark website. */
  theme?: 'light' | 'dark'
  font?: 'sans' | 'serif' | 'rounded'
  /** Outlined boxes, or filled ones with a line under. */
  fields?: 'outline' | 'filled'
}

export interface FormRecord {
  id: string
  name: string
  fields: string[]
  field_settings?: Record<string, FormFieldSettings>
  list_id: number
  save_to_list_enabled?: boolean
  /** Fields written onto the contact. Missing on forms from before it existed: first name, last name and company. */
  save_to_list_fields?: string[]
  welcome_email_enabled: boolean
  welcome_email_subject: string
  welcome_email_body: string
  welcome_email_delay_minutes: number
  sender_id: number | null
  submit_label?: string
  success_message?: string
  /** Shown above the fields, on its own page and in the embed. Empty: none. */
  heading?: string
  intro?: string
  /** The customer's privacy policy, linked under the button. */
  privacy_url?: string
  /** Where people go once they've sent it, in place of the thank-you message. */
  redirect_url?: string
  style?: FormStyle
  /** Paused forms refuse submissions, wherever they're embedded. */
  paused?: boolean
  created_at: string
  updated_at?: string
}

export type FormValue = string | string[] | boolean

export interface FormSubmissionRecord {
  /** Missing on submissions from before ids: `submissionId` makes one from the time and email. */
  id?: string
  form_id: string
  contact_email: string
  submitted_at: string
  /** Only on submissions from before `values`. */
  message?: string
  /** What was sent, by field key. Missing on submissions from before it was kept. */
  values?: Record<string, FormValue>
  /** The consent box's wording when they ticked it. */
  consent_text?: string
  /** The page it was sent from (no query string but its utm_ tags), and the page before. */
  source?: FormSource
  /** What sending it did. Missing on submissions from before it was kept. */
  outcome?: { list_id?: number; new_contact?: boolean; welcome_email_id?: string }
}

export interface FormSource {
  page?: string
  referrer?: string
  utm?: Record<string, string>
}

export const DEFAULT_SUBMIT_LABEL = 'Submit'
export const DEFAULT_SUCCESS_MESSAGE = "Thanks! We'll be in touch shortly."
export const DEFAULT_ACCENT = '#111827'
const LEGACY_SAVE_FIELDS = ['first_name', 'last_name', 'company']

export const FORM_LIMITS = { fields: 20, label: 80, placeholder: 120, submitLabel: 40, successMessage: 400, value: 2000 }

type FormInputType = 'text' | 'email' | 'textarea' | 'number' | 'date' | 'checkbox' | 'select' | 'multiselect'

/** A field as a page draws it. */
export interface ResolvedFormField {
  key: string
  label: string
  type: FormInputType
  required: boolean
  placeholder: string
  help: string
  /** Filled from the page address's `param`, not shown. */
  hidden: boolean
  param: string
  options?: string[]
  /** It goes onto the contact (built-in column or custom field), not just the submission. */
  contact: boolean
}

export const isBuiltin = (key: string): key is BuiltinFormField => (BUILTIN_FORM_FIELDS as readonly string[]).includes(key)
export const customKey = (key: string) => (key.startsWith('custom:') ? key.slice(7) : null)

/** Required unless changed: email always, first name and consent by default (first name as every form was before it could be changed). */
function isRequired(form: Pick<FormRecord, 'field_settings'>, key: string) {
  if (key === 'email') return true
  return form.field_settings?.[key]?.required ?? (key === 'first_name' || key === 'consent')
}

/** Custom fields that can be filled from a page's address: one value, as text. */
const canHide = (type: ContactFieldDef['type']) => type === 'text' || type === 'number' || type === 'select'

/** A hidden field's value, read from the page's address. */
export function hiddenValues(fields: ResolvedFormField[], page: string | null | undefined): Record<string, string> {
  if (!page) return {}
  let params: URLSearchParams
  try {
    params = new URL(page).searchParams
  } catch {
    return {}
  }
  return Object.fromEntries(fields.filter((f) => f.hidden && params.get(f.param)).map((f) => [f.key, params.get(f.param)!.slice(0, 200)]))
}

const TYPE_OF: Record<ContactFieldDef['type'], FormInputType> = {
  text: 'text', number: 'number', date: 'date', boolean: 'checkbox', select: 'select', multiselect: 'multiselect',
}

/** The form's fields in order, as drawn. A custom field that's since been deleted is left out. */
export function resolveFields(form: Pick<FormRecord, 'fields' | 'field_settings'>, contactFields: ContactFieldDef[]): ResolvedFormField[] {
  const defs = new Map(contactFields.map((f) => [f.key, f]))
  const out: ResolvedFormField[] = []
  // Email first if a form somehow lacks it, as every form has one.
  const keys = form.fields.includes('email') ? form.fields : ['email', ...form.fields]
  for (const key of keys) {
    const settings = form.field_settings?.[key] ?? {}
    const custom = customKey(key)
    if (custom !== null) {
      const def = defs.get(custom)
      if (!def) continue
      out.push({
        key, label: settings.label?.trim() || def.label, type: TYPE_OF[def.type], required: !settings.hidden && isRequired(form, key),
        placeholder: settings.placeholder ?? '', help: settings.help ?? '', options: def.options, contact: true,
        hidden: !!settings.hidden && canHide(def.type), param: settings.param?.trim() || custom,
      })
    } else if (isBuiltin(key)) {
      const label = settings.label?.trim() || (key === 'consent' ? DEFAULT_CONSENT_TEXT : BUILTIN_LABELS[key])
      const type: FormInputType = key === 'email' ? 'email' : key === 'message' ? 'textarea' : key === 'consent' ? 'checkbox' : 'text'
      out.push({
        key, label, type, required: isRequired(form, key), placeholder: settings.placeholder ?? '', help: settings.help ?? '', contact: key !== 'message' && key !== 'consent',
        hidden: false, param: key,
      })
    }
  }
  return out
}

/** What a hosted page or embed needs: nothing about lists, emails or who sent what. */
export interface PublicForm {
  id: string
  name: string
  heading: string
  intro: string
  privacyUrl: string
  redirectUrl: string
  fields: ResolvedFormField[]
  submitLabel: string
  successMessage: string
  style: Required<FormStyle>
  paused: boolean
}

export function publicForm(form: FormRecord, contactFields: ContactFieldDef[]): PublicForm {
  return {
    id: form.id,
    name: form.name,
    heading: form.heading?.trim() ?? '',
    intro: form.intro?.trim() ?? '',
    privacyUrl: safeUrl(form.privacy_url) ?? '',
    redirectUrl: safeUrl(form.redirect_url) ?? '',
    fields: resolveFields(form, contactFields),
    submitLabel: form.submit_label?.trim() || DEFAULT_SUBMIT_LABEL,
    successMessage: form.success_message?.trim() || DEFAULT_SUCCESS_MESSAGE,
    style: {
      accent: validAccent(form.style?.accent) ?? DEFAULT_ACCENT,
      corners: form.style?.corners ?? 'rounded',
      theme: form.style?.theme === 'dark' ? 'dark' : 'light',
      font: form.style?.font === 'serif' || form.style?.font === 'rounded' ? form.style.font : 'sans',
      fields: form.style?.fields === 'filled' ? 'filled' : 'outline',
    },
    paused: !!form.paused,
  }
}

/** An http(s) address, or null: nothing else is linked from a form. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export const validAccent = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type CheckedSubmission =
  | { ok: true; email: string; values: Record<string, FormValue>; custom: Record<string, ContactCustomValue> }
  | { ok: false; problems: Record<string, string> }

/**
 * Checks what a visitor sent against the form's fields: every required one
 * filled, the email an email, a custom field's value one it can hold. Keys
 * the form doesn't have are ignored.
 */
export function checkSubmission(fields: ResolvedFormField[], body: Record<string, unknown>, contactFields: ContactFieldDef[]): CheckedSubmission {
  const defs = new Map(contactFields.map((f) => [f.key, f]))
  const problems: Record<string, string> = {}
  const values: Record<string, FormValue> = {}
  const custom: Record<string, ContactCustomValue> = {}
  for (const field of fields) {
    const raw = body[field.key]
    let value: FormValue | null
    if (field.type === 'checkbox') {
      value = raw === true || raw === 'true' || raw === 'on' || raw === 'yes' || raw === '1'
    } else if (field.type === 'multiselect') {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? raw.split(',') : []
      const picked = list.map((v) => String(v).trim()).filter(Boolean)
      value = picked.length ? picked : null
    } else {
      const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : ''
      value = text ? text.slice(0, FORM_LIMITS.value) : null
    }
    if (value === null || value === false) {
      if (field.required) problems[field.key] = field.type === 'checkbox' ? 'Tick this to continue.' : field.type === 'select' || field.type === 'multiselect' ? 'Choose an option.' : `Enter your ${field.label.toLowerCase()}.`
      if (value === false) values[field.key] = false
      continue
    }
    if (field.key === 'email') {
      const email = String(value).toLowerCase()
      if (!EMAIL_RE.test(email)) {
        problems.email = 'Enter an email address like name@company.com.'
        continue
      }
      value = email
    }
    const ck = customKey(field.key)
    if (ck !== null) {
      const def = defs.get(ck)
      if (def) {
        const coerced = coerceCustomValue(value, def)
        if (!coerced.ok) {
          problems[field.key] = coerced.problem
          continue
        }
        custom[ck] = coerced.value
      }
    }
    values[field.key] = value
  }
  if (Object.keys(problems).length) return { ok: false, problems }
  return { ok: true, email: String(values.email), values, custom }
}

/** A submission's value for a field: what was sent, or for older submissions, what the contact holds. */
export function submissionValue(
  sub: FormSubmissionRecord & { contact?: { first_name?: string; last_name?: string; company?: string; job_title?: string; custom?: Record<string, ContactCustomValue> } | null },
  key: string,
): string {
  if (key === 'email') return sub.contact_email
  const v = sub.values?.[key]
  if (v !== undefined) return Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v
  if (sub.values) return ''
  if (key === 'message') return sub.message ?? ''
  if (key === 'first_name' || key === 'last_name' || key === 'company' || key === 'job_title') return sub.contact?.[key] ?? ''
  const ck = customKey(key)
  const cv = ck !== null ? sub.contact?.custom?.[ck] : undefined
  if (cv === undefined || cv === null) return ''
  return Array.isArray(cv) ? cv.join(', ') : typeof cv === 'boolean' ? (cv ? 'Yes' : 'No') : String(cv)
}

/** Fields written onto the contact. */
export function contactFieldsOf(form: Pick<FormRecord, 'save_to_list_fields' | 'fields'>) {
  return (form.save_to_list_fields ?? LEGACY_SAVE_FIELDS).filter((k) => form.fields.includes(k) && k !== 'message' && k !== 'email' && k !== 'consent')
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Replaces `{{first_name}}` and friends in a welcome email with what was sent.
 * `html` escapes what the visitor typed, so a name can't put a link in the email.
 */
export function fillMergeTags(text: string, values: Record<string, FormValue>, opts: { html?: boolean } = {}) {
  return text.replace(/\{\{\s*([a-z0-9_:]+)\s*\}\}/gi, (_, key: string) => {
    const v = values[key]
    if (v === undefined) return ''
    const s = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v
    return opts.html ? escapeHtml(s) : s
  })
}

/** The hidden field bots fill and people don't: a submission with it is thanked and dropped. */
export const HONEYPOT = '_magpie_hp'

export const submissionId = (s: Pick<FormSubmissionRecord, 'id' | 'submitted_at' | 'contact_email'>) => s.id ?? `${s.submitted_at}|${s.contact_email}`

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

/**
 * Where a submission came from, as the page told us: the address without its
 * query string (which can carry anything, an email included), keeping only
 * its utm_ tags; the page before it, as a site and path. Nothing that isn't
 * an http(s) address.
 */
export function cleanSource(page: unknown, referrer: unknown): FormSource | undefined {
  const parse = (v: unknown) => {
    if (typeof v !== 'string' || v.length > 2000) return null
    try {
      const u = new URL(v)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
    } catch {
      return null
    }
  }
  const p = parse(page)
  const r = parse(referrer)
  const out: FormSource = {}
  if (p) {
    out.page = `${p.host}${p.pathname}`.slice(0, 300)
    const utm = Object.fromEntries(UTM.flatMap((k) => (p.searchParams.get(k) ? [[k, p.searchParams.get(k)!.slice(0, 100)]] : [])))
    if (Object.keys(utm).length) out.utm = utm
  }
  if (r && r.host !== p?.host) out.referrer = `${r.host}${r.pathname}`.slice(0, 300)
  return Object.keys(out).length ? out : undefined
}
