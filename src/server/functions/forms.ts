import { createServerFn } from '@tanstack/react-start'

type FormInput = {
  name: string
  fields: string[]
  list_id: number
  save_to_list_enabled: boolean
  save_to_list_fields: string[]
  welcome_email_enabled: boolean
  welcome_email_subject: string
  welcome_email_body: string
  welcome_email_delay_minutes: number
  sender_id: number | null
}

export const getFormsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  return db.getForms().map(f => ({ ...f, submission_count: db.getFormSubmissionCount(f.id) }))
})

export const getFormFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const form = db.getForm(data.id)
    if (!form) throw new Error('Form not found')
    return { ...form, submission_count: db.getFormSubmissionCount(form.id) }
  })

export const getFormSubmissionsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { formId: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    return db.getFormSubmissions(data.formId)
  })

export const createFormFn = createServerFn({ method: 'POST' })
  .inputValidator((d: FormInput) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const id = db.addForm(data)
    return { id }
  })

export const updateFormFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; updates: Partial<FormInput> }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.updateForm(data.id, data.updates)
    return { success: true }
  })

export const deleteFormFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.deleteForm(data.id)
    return { success: true }
  })
