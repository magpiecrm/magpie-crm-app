import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { personaInput, websiteUrlInput } from '../prospecting/personaInput'
import type { PersonaDraft } from '../prospecting/personaDraft'

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

const draftInput = z.object({ websiteUrl: websiteUrlInput, note: z.string().trim().max(1_000).optional() })
const runIdInput = z.object({ id: z.uuid() })
const addDraftsInput = runIdInput.extend({ which: z.array(z.number().int().min(0).max(9)).min(1).max(10) })

/** The website's host, for a notification: it's the workspace's own. */
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '')

/**
 * The AI's persona draft: running, finished and waiting to be added from, or
 * null. It runs on the server (prospecting/aiRuns.ts), so the page can be left
 * and come back to. Nothing in it is saved until a draft is added.
 */
export const personaDraftFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  const { getAiRun } = await import('../prospecting/aiRuns')
  return getAiRun<PersonaDraft[]>('personas')
})

/** Starts drafting up to three personas from the website, or gives the draft already running. The bell says when it's done, if nobody's watching. */
export const startPersonaDraftFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof draftInput>) => draftInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { draftPersonas, requireDraftAi } = await import('../prospecting/personaDraft')
    const { startAiRun } = await import('../prospecting/aiRuns')
    const { notify } = await import('../notify')
    requireDraftAi()
    return startAiRun<PersonaDraft[]>('personas', data, (signal) => draftPersonas(data, { signal }), {
      onUnseen: (run) => {
        const host = hostOf(run.input.websiteUrl)
        const n = run.result?.length ?? 0
        notify(
          'ai_ready',
          run.status === 'done'
            ? `The AI drafted ${n} persona${n === 1 ? '' : 's'} from ${host}. Review ${n === 1 ? 'it' : 'them'} on Personas.`
            : `Drafting personas from ${host} didn't finish: ${run.error}`,
          { url: '/collection/personas' },
        )
      },
    })
  })

/** Adds drafts from the AI's persona draft as personas, by their place in it. One already added isn't added again. */
export const addDraftedPersonasFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof addDraftsInput>) => addDraftsInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const { updateAiRun } = await import('../prospecting/aiRuns')
    let unfinished = false
    // All at once, so two quick clicks can't add the same draft twice.
    const run = updateAiRun<PersonaDraft[]>('personas', data.id, (r) => {
      if (r.status !== 'done' || !r.result) return void (unfinished = true)
      for (const i of data.which) {
        const draft = r.result[i]
        if (!draft || r.added?.includes(i)) continue
        db.addPersona(draft)
        r.added = [...(r.added ?? []), i]
      }
    })
    if (!run) throw new Error('Those drafts have gone. Draft personas again.')
    if (unfinished) throw new Error("That draft hasn't finished yet.")
    return run
  })

/** Forgets the AI's persona draft, stopping it if it's still running. */
export const dismissPersonaDraftFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof runIdInput>) => runIdInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { clearAiRun } = await import('../prospecting/aiRuns')
    clearAiRun('personas', data.id)
    return { success: true }
  })
