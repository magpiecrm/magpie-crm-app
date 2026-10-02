import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Sequences (server/sequences/): making them, enrolling people, and their results.

const id = z.string().trim().min(1).max(100)
const email = z.string().trim().toLowerCase().email().max(320)

async function signedIn() {
  const { requireAuth } = await import('../auth.server')
  const session = await requireAuth()
  const { sequences } = await import('../sequences')
  return { sequences, actor: session.email as string }
}

const step = z.object({
  id: z.string().max(100).optional(),
  delay_days: z.number().int().min(0).max(90),
  subject: z.string().max(200).nullable(),
  body: z.string().max(10_000),
})

const settings = z
  .object({
    track_opens: z.boolean(),
    track_clicks: z.boolean(),
    days: z.array(z.number().int().min(0).max(6)).max(7),
    start_hour: z.number().int().min(0).max(24),
    end_hour: z.number().int().min(0).max(24),
    time_zone: z.string().max(64),
    daily_cap: z.number().int().min(1).max(500),
    signature: z.string().max(2000),
    footer: z.string().max(1000),
  })
  .partial()

export const sequencesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { sequences } = await signedIn()
  return sequences.list()
})

export const sequenceFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sequences } = await signedIn()
    return { ...sequences.get(data.id), stepStats: sequences.stepStats(data.id) }
  })

export const createSequenceFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string; senderId?: number | null; timeZone?: string }) =>
    z.object({ name: z.string().trim().min(1).max(120), senderId: z.number().int().nullable().optional(), timeZone: z.string().max(64).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sequences, actor } = await signedIn()
    return sequences.create(data, actor)
  })

export const updateSequenceFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: { id: string; name?: string; senderId?: number | null; steps?: z.infer<typeof step>[]; settings?: z.infer<typeof settings> }) =>
      z
        .object({
          id,
          name: z.string().max(120).optional(),
          senderId: z.number().int().nullable().optional(),
          steps: z.array(step).max(10).optional(),
          settings: settings.optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const { sequences } = await signedIn()
    const { id: sequenceId, ...patch } = data
    return sequences.update(sequenceId, patch)
  })

export const setSequenceStatusFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; status: 'active' | 'paused' | 'archived' }) => z.object({ id, status: z.enum(['active', 'paused', 'archived']) }).parse(d))
  .handler(async ({ data }) => {
    const { sequences } = await signedIn()
    return sequences.setStatus(data.id, data.status)
  })

export const deleteSequenceFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sequences } = await signedIn()
    sequences.remove(data.id)
    return { success: true }
  })

/** Enrolls a list's contacts or chosen ones. `dryRun` says how many would be, and why the rest wouldn't. */
export const enrollInSequenceFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; listId?: number; emails?: string[]; dryRun?: boolean }) =>
    z.object({ id, listId: z.number().int().optional(), emails: z.array(email).max(5000).optional(), dryRun: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sequences, actor } = await signedIn()
    const { db } = await import('../db')
    const emails = data.listId !== undefined ? db.data.list_contacts.filter((lc) => lc.list_id == data.listId).map((lc) => lc.contact_email) : (data.emails ?? [])
    if (!emails.length) throw new Error(data.listId !== undefined ? 'That list has nobody in it.' : 'Choose who to enroll.')
    return sequences.enroll(data.id, emails, { dryRun: data.dryRun }, actor)
  })

export const sequenceEnrollmentsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sequences } = await signedIn()
    return sequences.enrollments(data.id)
  })

export const enrollmentActionFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { ids: string[]; action: 'pause' | 'resume' | 'mark_replied' | 'stop' | 'remove' }) =>
    z.object({ ids: z.array(id).min(1).max(5000), action: z.enum(['pause', 'resume', 'mark_replied', 'stop', 'remove']) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sequences } = await signedIn()
    return sequences.act(data.ids, data.action)
  })

/** One email as a contact would get it (merge tags filled in from a sample contact), for the editor's preview. */
export const previewSequenceStepFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; stepIndex: number; subject: string | null; body: string; contactEmail?: string }) =>
    z.object({ id, stepIndex: z.number().int().min(0).max(9), subject: z.string().max(200).nullable(), body: z.string().max(10_000), contactEmail: email.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    await signedIn()
    const { previewStep } = await import('../sequences/preview')
    return previewStep(data.id, data.stepIndex, data.subject, data.body, data.contactEmail)
  })
