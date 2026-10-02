import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Senders' connected inboxes, read for replies to sequence emails (server/mailboxes/).

async function signedIn() {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  return import('../mailboxes')
}

export const mailboxesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { mailboxes } = await signedIn()
  return mailboxes.list()
})

/** Connects a sender's inbox after checking the login works (the password is kept when left out). */
export const saveMailboxFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { senderId: number; host: string; port: number; secure: boolean; user: string; password?: string }) =>
    z
      .object({
        senderId: z.number().int(),
        host: z
          .string()
          .trim()
          .min(3)
          .max(253)
          .regex(/^[a-z0-9.-]+$/i, "That isn't a server name."),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string().trim().min(1).max(320),
        password: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { mailboxes } = await signedIn()
    return mailboxes.save(data)
  })

export const deleteMailboxFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { mailboxes } = await signedIn()
    mailboxes.remove(data.id)
    return { success: true }
  })

/** Reads the connected inboxes now, rather than at the next check (within 3 minutes). */
export const checkMailboxesNowFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { pollMailboxes, mailboxes } = await signedIn()
  await pollMailboxes()
  return mailboxes.list()
})
