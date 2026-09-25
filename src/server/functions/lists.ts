import { createServerFn } from '@tanstack/react-start'

export const listsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    const { getLists } = await import('../emailService')
    await requireAuth()
    return getLists()
  })

export const createListFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { createList } = await import('../emailService')
    await requireAuth()
    return createList(data.name)
  })

export const deleteListFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { deleteList } = await import('../emailService')
    await requireAuth()
    await deleteList(data.id)
    return { success: true }
  })

export const removeContactFromListFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { listId: number; email: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { removeContactFromList } = await import('../emailService')
    await requireAuth()
    await removeContactFromList(data.listId, data.email)
    return { success: true }
  })
