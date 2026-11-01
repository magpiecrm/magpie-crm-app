import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { listFiltersSchema } from '../../features/contacts/listFilterSchema'

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

/** What lists can be built from: fields and their values, no contacts. */
export const listFilterFieldsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { listFieldInfo } = await import('../listBuilder')
  await requireAuth()
  return listFieldInfo()
})

/** Makes a list from filters, or with `dryRun` says what it would hold. */
export const buildListFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ name: z.string().max(200).optional(), filters: listFiltersSchema, dryRun: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { buildList, previewList } = await import('../listBuilder')
    await requireAuth()
    if (data.dryRun) return previewList(data.filters)
    return buildList({ name: data.name ?? '', filters: data.filters })
  })

/** Adds who now matches a list's saved filters, or with `dryRun` says who that would be. */
export const addNewMatchesFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ listId: z.number().int().positive(), dryRun: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { addNewMatches, previewNewMatches } = await import('../listBuilder')
    await requireAuth()
    return data.dryRun ? previewNewMatches(data.listId) : addNewMatches(data.listId)
  })

export const deleteListFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.number().int().positive() }))
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
