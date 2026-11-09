import { createServerFn } from '@tanstack/react-start'
import type { FormCorners, FormFieldSettings, FormRecord } from '../../features/forms/model'

/** What the builder saves. */
export type FormInput = Pick<
  FormRecord,
  | 'name' | 'fields' | 'field_settings' | 'list_id' | 'save_to_list_enabled' | 'save_to_list_fields'
  | 'welcome_email_enabled' | 'welcome_email_subject' | 'welcome_email_body' | 'welcome_email_delay_minutes' | 'sender_id'
  | 'submit_label' | 'success_message' | 'style' | 'heading' | 'intro'
>

const CORNERS: FormCorners[] = ['square', 'rounded', 'pill']

/** A form as the builder sent it, checked: known fields only, lengths capped, numbers in range. */
async function cleanForm(d: Partial<FormInput>): Promise<Partial<FormInput>> {
  const { FORM_LIMITS, isBuiltin, customKey, validAccent } = await import('../../features/forms/model')
  const { db } = await import('../db')
  const custom = new Set(db.getContactFields().map((f) => f.key))
  const out: Partial<FormInput> = {}
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  if (d.name !== undefined) {
    out.name = text(d.name, 120).trim()
    if (!out.name) throw new Error('Give the form a name.')
  }
  const known = (k: unknown): k is string => typeof k === 'string' && (isBuiltin(k) || (customKey(k) !== null && custom.has(customKey(k)!)))
  if (d.fields !== undefined) {
    const fields = [...new Set(d.fields.filter(known))].slice(0, FORM_LIMITS.fields)
    out.fields = fields.includes('email') ? fields : ['email', ...fields]
  }
  if (d.field_settings !== undefined) {
    const settings: Record<string, FormFieldSettings> = {}
    for (const [k, v] of Object.entries(d.field_settings ?? {})) {
      if (!known(k) || !v || typeof v !== 'object') continue
      const s: FormFieldSettings = {}
      if (typeof v.label === 'string' && v.label.trim()) s.label = text(v.label, k === 'consent' ? FORM_LIMITS.successMessage : FORM_LIMITS.label).trim()
      if (typeof v.placeholder === 'string' && v.placeholder.trim()) s.placeholder = text(v.placeholder, FORM_LIMITS.placeholder).trim()
      if (typeof v.required === 'boolean' && k !== 'email') s.required = v.required
      if (typeof v.help === 'string' && v.help.trim()) s.help = text(v.help, FORM_LIMITS.placeholder).trim()
      if (Object.keys(s).length) settings[k] = s
    }
    out.field_settings = settings
  }
  if (d.list_id !== undefined) out.list_id = Number(d.list_id) || 0
  if (d.save_to_list_enabled !== undefined) out.save_to_list_enabled = !!d.save_to_list_enabled
  if (d.save_to_list_fields !== undefined) out.save_to_list_fields = [...new Set((d.save_to_list_fields ?? []).filter(known))]
  if (d.welcome_email_enabled !== undefined) out.welcome_email_enabled = !!d.welcome_email_enabled
  if (d.welcome_email_subject !== undefined) out.welcome_email_subject = text(d.welcome_email_subject, 200)
  if (d.welcome_email_body !== undefined) out.welcome_email_body = text(d.welcome_email_body, 10000)
  if (d.welcome_email_delay_minutes !== undefined) out.welcome_email_delay_minutes = Math.min(1440, Math.max(0, Math.round(Number(d.welcome_email_delay_minutes) || 0)))
  if (d.sender_id !== undefined) out.sender_id = d.sender_id ? Number(d.sender_id) : null
  if (d.submit_label !== undefined) out.submit_label = text(d.submit_label, FORM_LIMITS.submitLabel).trim()
  if (d.success_message !== undefined) out.success_message = text(d.success_message, FORM_LIMITS.successMessage).trim()
  if (d.heading !== undefined) out.heading = text(d.heading, 120).trim()
  if (d.intro !== undefined) out.intro = text(d.intro, FORM_LIMITS.successMessage).trim()
  if (d.style !== undefined) {
    out.style = {
      ...(validAccent(d.style?.accent) ? { accent: validAccent(d.style?.accent)! } : {}),
      ...(d.style?.corners && CORNERS.includes(d.style.corners) ? { corners: d.style.corners } : {}),
      ...(d.style?.theme === 'dark' ? { theme: 'dark' as const } : {}),
    }
  }
  if (out.save_to_list_enabled && out.list_id !== undefined && !db.data.lists.some((l) => l.id === out.list_id)) throw new Error('Choose a list.')
  return out
}

export const getFormsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  const stats = db.getFormStats()
  return db.getForms().map((f) => {
    const st = stats.get(f.id)
    const views = db.getFormViews(f.id)
    return { ...f, submission_count: st?.total ?? 0, submissions_this_week: st?.week ?? 0, last_submission_at: st?.last ?? null, views: views.total, views_this_week: views.week }
  })
})

export const getFormFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => ({ id: String(d.id) }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const form = db.getForm(data.id)
    if (!form) throw new Error('Form not found')
    const st = db.getFormStats().get(form.id)
    const views = db.getFormViews(form.id)
    return { ...form, submission_count: st?.total ?? 0, submissions_this_week: st?.week ?? 0, last_submission_at: st?.last ?? null, views: views.total, views_this_week: views.week }
  })

export const getFormSubmissionsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { formId: string }) => ({ formId: String(d.formId) }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const emails = new Map((db.data.pending_emails ?? []).map((e) => [e.id, e]))
    const lists = new Map(db.data.lists.map((l) => [l.id, l.name]))
    // The contact's columns only, for submissions from before what was sent was kept.
    return db.getFormSubmissions(data.formId).map(({ contact, ...s }) => {
      const mail = s.outcome?.welcome_email_id ? emails.get(s.outcome.welcome_email_id) : undefined
      return {
        ...s,
        contact: contact ? { first_name: contact.first_name, last_name: contact.last_name, company: contact.company, job_title: contact.job_title, custom: contact.custom } : null,
        list_name: s.outcome?.list_id ? (lists.get(s.outcome.list_id) ?? null) : null,
        welcome_email: mail
          ? { status: mail.outcome ?? (mail.sent ? ('sent' as const) : ('due' as const)), at: mail.send_after }
          : s.outcome?.welcome_email_id
            ? { status: 'sent' as const, at: null }
            : null,
      }
    })
  })

/** The form as its hosted page and embed draw it: no lists, emails or submissions. */
export const getPublicFormFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string; view?: boolean }) => ({ id: String(d.id), view: d.view === true }))
  .handler(async ({ data }) => {
    const { db } = await import('../db')
    const { publicForm } = await import('../../features/forms/model')
    const form = db.getForm(data.id)
    // A view is the form's own page or embed being drawn for someone: counts by day, nothing about who.
    if (form && data.view) db.addFormView(form.id)
    return form ? publicForm(form, db.getContactFields()) : null
  })

export const createFormFn = createServerFn({ method: 'POST' })
  .inputValidator((d: FormInput) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const clean = await cleanForm(data)
    const id = db.addForm({
      name: clean.name ?? 'Untitled form',
      fields: clean.fields ?? ['first_name', 'email'],
      field_settings: clean.field_settings ?? {},
      list_id: clean.list_id ?? 1,
      save_to_list_enabled: clean.save_to_list_enabled ?? true,
      save_to_list_fields: clean.save_to_list_fields ?? ['first_name', 'last_name', 'company'],
      welcome_email_enabled: clean.welcome_email_enabled ?? false,
      welcome_email_subject: clean.welcome_email_subject ?? '',
      welcome_email_body: clean.welcome_email_body ?? '',
      welcome_email_delay_minutes: clean.welcome_email_delay_minutes ?? 5,
      sender_id: clean.sender_id ?? null,
      submit_label: clean.submit_label,
      success_message: clean.success_message,
      style: clean.style ?? {},
    })
    return { id }
  })

export const updateFormFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; updates: Partial<FormInput> }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    if (!db.getForm(data.id)) throw new Error('Form not found')
    db.updateForm(data.id, await cleanForm(data.updates))
    return { success: true }
  })

/** Paused forms refuse new submissions wherever they're embedded; they keep their code and submissions. */
export const setFormPausedFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; paused: boolean }) => ({ id: String(d.id), paused: !!d.paused }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    if (!db.getForm(data.id)) throw new Error('Form not found')
    db.updateForm(data.id, { paused: data.paused })
    return { success: true }
  })

export const duplicateFormFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => ({ id: String(d.id) }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    return { id: db.duplicateForm(data.id) }
  })

export const deleteFormFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => ({ id: String(d.id) }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.deleteForm(data.id)
    return { success: true }
  })

/** Deletes one submission, as asked by the person who sent it. Their contact, if one was made, stays. */
export const deleteFormSubmissionFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { formId: string; id: string }) => ({ formId: String(d.formId), id: String(d.id) }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    if (!db.deleteFormSubmission(data.formId, data.id)) throw new Error('Submission not found')
    return { success: true }
  })
