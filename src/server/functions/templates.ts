import { createServerFn } from '@tanstack/react-start'

export const getTemplatesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { listTemplates } = await import('../emailTemplates')
  await requireAuth()
  return listTemplates()
})

export const getTemplateFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { getTemplateOrThrow } = await import('../emailTemplates')
    await requireAuth()
    return getTemplateOrThrow(data.id)
  })

export const createTemplateFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: { name: string; description?: string; html?: string; fromCampaignId?: number; starterId?: string }) => d,
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { createTemplate } = await import('../emailTemplates')
    await requireAuth()
    return createTemplate(data)
  })

export const updateTemplateFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; name?: string; description?: string; html?: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { updateTemplate } = await import('../emailTemplates')
    await requireAuth()
    const { id, ...patch } = data
    return updateTemplate(id, patch)
  })

export const duplicateTemplateFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { duplicateTemplate } = await import('../emailTemplates')
    await requireAuth()
    return duplicateTemplate(data.id)
  })

export const deleteTemplateFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { deleteTemplate } = await import('../emailTemplates')
    await requireAuth()
    deleteTemplate(data.id)
    return { success: true }
  })
