import { createServerFn } from '@tanstack/react-start'
import type { PersonaCriteria as PersonaCriteriaInput } from '../../features/prospects/types'

type PersonaInput = {
  name: string
  description: string
  criteria: PersonaCriteriaInput
  painPoints: string
  valueProp: string
}

export const getPersonasFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  return db.getPersonas()
})

export const getPersonaFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const persona = db.getPersona(data.id)
    if (!persona) throw new Error('Persona not found')
    return persona
  })

export const createPersonaFn = createServerFn({ method: 'POST' })
  .inputValidator((d: PersonaInput) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const id = db.addPersona(data)
    return { id }
  })

export const updatePersonaFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; updates: Partial<PersonaInput> }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.updatePersona(data.id, data.updates)
    return { success: true }
  })

export const deletePersonaFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.deletePersona(data.id)
    return { success: true }
  })
