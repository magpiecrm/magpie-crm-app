import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { personaInput } from '../prospecting/personaInput'

const idInput = z.object({ id: z.string().min(1).max(64) })

export const getPersonasFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  return db.getPersonas()
})

export const getPersonaFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => idInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const persona = db.getPersona(data.id)
    if (!persona) throw new Error('Persona not found')
    return persona
  })

export const createPersonaFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof personaInput>) => personaInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const id = db.addPersona(data)
    return { id }
  })

export const updatePersonaFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; updates: z.input<ReturnType<typeof personaInput.partial>> }) =>
    idInput.extend({ updates: personaInput.partial() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    if (!db.updatePersona(data.id, data.updates)) throw new Error('Persona not found')
    return { success: true }
  })

export const deletePersonaFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => idInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.deletePersona(data.id)
    return { success: true }
  })

/** What came of the people found with each persona, by persona id. Counts only. */
export const getPersonaStatsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  const { personaStats } = await import('../personaStats')
  return personaStats(db.data)
})

/** Whether the AI can draft personas here, and the website to start from (the brand kit's). */
export const personaDraftStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  const { aiAvailable } = await import('../copilot/availability')
  return { ai: aiAvailable(), websiteUrl: db.getBrandKit()?.websiteUrl ?? '' }
})

// "acme.com" is taken as https://acme.com.
const websiteUrl = z
  .string()
  .trim()
  .min(1, "Enter your company's website")
  .transform((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
  .pipe(z.url({ protocol: /^https?$/, message: "That doesn't look like a website address" }).max(300))

const draftInput = z.object({ websiteUrl, note: z.string().trim().max(1_000).optional() })

/** Up to three personas the AI suggests from the website. Nothing is saved: the page adds the ones chosen. */
export const draftPersonasFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof draftInput>) => draftInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { draftPersonas } = await import('../prospecting/personaDraft')
    const { AiFailed } = await import('../copilot/generate')
    try {
      return await draftPersonas(data)
    } catch (err) {
      if (err instanceof AiFailed) throw new Error(`The AI couldn't finish: ${err.message} Try again in a moment.`)
      throw err
    }
  })
