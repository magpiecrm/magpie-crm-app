import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Senders' connected inboxes, read for replies to sequence emails, and sending
// those emails once they've checked out (server/mailboxes/).

async function signedIn() {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  return import('../mailboxes')
}

export const mailboxesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { mailboxes } = await signedIn()
  return mailboxes.list()
})

const serverName = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9.-]+$/i, "That isn't a server name.")

/**
 * Connects a sender's inbox after checking the login works (the password is
 * kept when left out), and checks it can send their sequence emails: through
 * the sending server and login given, else the ones that go with the inbox.
 */
export const saveMailboxFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { senderId: number; host: string; port: number; secure: boolean; user: string; password?: string; smtp?: { host?: string; port?: number; user?: string; password?: string } }) =>
    z
      .object({
        senderId: z.number().int(),
        host: serverName,
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string().trim().min(1).max(320),
        password: z.string().max(500).optional(),
        smtp: z
          .object({
            host: serverName.optional(),
            port: z.union([z.literal(587), z.literal(465)]).optional(),
            user: z.string().trim().max(320).optional(),
            password: z.string().max(500).optional(),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { mailboxes } = await signedIn()
    return mailboxes.save(data)
  })

/** A sender's choices about sending through their inbox: the workspace's mail server instead, and the most a day. */
export const setMailboxSendingFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; useServer?: boolean; dailyCap?: number }) =>
    z.object({ id: z.string().min(1).max(100), useServer: z.boolean().optional(), dailyCap: z.number().int().min(1).max(150).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { mailboxes } = await signedIn()
    return mailboxes.setSending(data.id, data)
  })

/** Checks again that an inbox can send (one email to itself), after fixing it or a pause. */
export const recheckMailboxSendingFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { mailboxes } = await signedIn()
    return mailboxes.recheckSending(data.id)
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
