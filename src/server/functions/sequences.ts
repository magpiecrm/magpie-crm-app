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

/** The first email written for each person by the AI, from this brief; null turns it off. */
const personalise = z.object({ brief: z.string().max(2_000) }).nullable()

const step = z.object({
  id: z.string().max(100).optional(),
  delay_days: z.number().int().min(0).max(90),
  subject: z.string().max(200).nullable(),
  body: z.string().max(10_000),
  personalise: personalise.optional(),
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
    const { aiAvailable } = await import('../copilot/availability')
    // Whether its first email can be written for each person here, and why not.
    return { ...sequences.get(data.id), stepStats: sequences.stepStats(data.id), ai: aiAvailable() }
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

/** One person's own version of one email, before it's gone: write it again, or keep it as edited by hand. */
export const sequenceDraftFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { enrollmentId: string; stepId: string; rewrite?: boolean; subject?: string; body?: string }) =>
    z
      .object({ enrollmentId: id, stepId: id, rewrite: z.boolean().optional(), subject: z.string().max(200).optional(), body: z.string().max(10_000).optional() })
      .refine((v) => v.rewrite || v.body !== undefined, 'Give the email, or ask for it to be written again.')
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { sequences } = await signedIn()
    return sequences.draft(data.enrollmentId, data.stepId, data.rewrite ? { rewrite: true } : { subject: data.subject, body: data.body! })
  })

/** A first email written now for one contact from the step as it's being edited, for "Try it on…": not kept, and nothing is sent. */
export const tryPersonalEmailFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; subject: string | null; body: string; brief: string; contactEmail: string }) =>
    z.object({ id, subject: z.string().max(200).nullable(), body: z.string().max(10_000), brief: z.string().max(2_000), contactEmail: email }).parse(d),
  )
  .handler(async ({ data }) => {
    await signedIn()
    const { previewPersonal } = await import('../sequences/preview')
    return previewPersonal(data.id, { subject: data.subject, body: data.body, personalise: { brief: data.brief } }, data.contactEmail)
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

/** How likely a sequence's emails are to land in spam, each and at worst, with what to change; `steps` and `settings` score an unsaved draft. */
export const sequenceSpamScoreFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; steps?: Array<{ subject: string | null; body: string }>; settings?: z.infer<typeof settings> }) =>
    z.object({ id, steps: z.array(step.pick({ subject: true, body: true })).max(10).optional(), settings: settings.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    await signedIn()
    const { sequenceSpamScore } = await import('../spamScore')
    return sequenceSpamScore(data.id, { steps: data.steps, settings: data.settings })
  })

/** Everyone in a sequence who has replied, the latest conversation first, for its Replies tab. */
export const sequenceRepliesFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    await signedIn()
    const { conversations } = await import('../sequences/conversation')
    return conversations.replies(data.id)
  })

/** One person's whole conversation with a sequence: its emails, their replies and the answers. */
export const sequenceConversationFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { enrollmentId: string }) => z.object({ enrollmentId: id }).parse(d))
  .handler(async ({ data }) => {
    await signedIn()
    const { conversations } = await import('../sequences/conversation')
    return conversations.get(data.enrollmentId)
  })

/** Marks their messages in a conversation as looked at. */
export const markConversationSeenFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { enrollmentId: string }) => z.object({ enrollmentId: id }).parse(d))
  .handler(async ({ data }) => {
    await signedIn()
    const { conversations } = await import('../sequences/conversation')
    return conversations.markSeen(data.enrollmentId)
  })

/** Answers someone who replied, from the sequence's sender, in the thread; `clientId` keeps a retry from sending it twice. */
export const sendSequenceReplyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { enrollmentId: string; text: string; clientId: string }) =>
    z.object({ enrollmentId: id, text: z.string().max(20_000), clientId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { actor } = await signedIn()
    const { sendReply } = await import('../sequences/conversation')
    const { message } = await sendReply(data.enrollmentId, { text: data.text, clientId: data.clientId }, actor)
    return { id: message.id, at: message.at }
  })

/** A draft answer to someone who replied, written by the AI, for the answer box; `notes` (what's typed there) steer it. Sends nothing. */
export const draftSequenceReplyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { enrollmentId: string; notes?: string }) => z.object({ enrollmentId: id, notes: z.string().max(2_000).optional() }).parse(d))
  .handler(async ({ data }) => {
    await signedIn()
    const { draftReply } = await import('../sequences/replyDraft')
    return draftReply(data.enrollmentId, data.notes)
  })

/** Sell → Inbox: conversations across sequences, the latest first; those needing a reply, or all, from one sequence or every one. */
export const inboxFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { needsReply?: boolean; sequenceId?: string } | undefined) => z.object({ needsReply: z.boolean().optional(), sequenceId: id.optional() }).optional().parse(d))
  .handler(async ({ data }) => {
    await signedIn()
    const { conversations } = await import('../sequences/conversation')
    return conversations.inbox(data)
  })

/** How many conversations wait for an answer, for the sidebar. */
export const inboxWaitingFn = createServerFn({ method: 'GET' }).handler(async () => {
  await signedIn()
  const { conversations } = await import('../sequences/conversation')
  return conversations.waiting()
})

/** Marks a conversation as needing no answer, or as needing one again. */
export const setConversationDoneFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { enrollmentId: string; done: boolean }) => z.object({ enrollmentId: id, done: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await signedIn()
    const { conversations } = await import('../sequences/conversation')
    conversations.setDone(data.enrollmentId, data.done)
    return { ok: true }
  })
