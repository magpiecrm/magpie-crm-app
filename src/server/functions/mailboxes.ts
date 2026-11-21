import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { validInput } from '../validInput'

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

const notAServer = "That isn't a server name, like imap.example.com."
const serverName = z.string(notAServer).trim().min(3, notAServer).max(253, notAServer).regex(/^[a-z0-9.-]+$/i, notAServer)
const sendingServer = z
  .string()
  .trim()
  .min(3, "The sending server isn't a server name, like smtp.example.com.")
  .max(253, "The sending server isn't a server name, like smtp.example.com.")
  .regex(/^[a-z0-9.-]+$/i, "The sending server isn't a server name, like smtp.example.com.")

/**
 * Connects a sender's inbox after checking the login works (the password is
 * kept when left out), and checks it can send their sequence emails: through
 * the sending server and login given, else the ones that go with the inbox.
 */
export const saveMailboxFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { senderId: number; host: string; port: number; secure: boolean; user: string; password?: string; smtp?: { host?: string; port?: number; user?: string; password?: string } }) =>
    validInput(
      z.object({
        senderId: z.number().int(),
        host: serverName,
        port: z.number("Enter the port, a number.").int('The port is a whole number.').min(1, 'The port is between 1 and 65535.').max(65535, 'The port is between 1 and 65535.'),
        secure: z.boolean(),
        user: z.string('Enter the login.').trim().min(1, 'Enter the login.').max(320, 'That login is too long.'),
        password: z.string().max(500, 'That password is too long.').optional(),
        smtp: z
          .object({
            // Left empty, the sending server goes back to the one that goes with the inbox.
            host: z.union([z.literal(''), sendingServer]).optional(),
            port: z.union([z.literal(587), z.literal(465)], 'Sending goes through port 587 or 465.').optional(),
            user: z.string().trim().max(320, 'That sending login is too long.').optional(),
            password: z.string().max(500, 'That password is too long.').optional(),
          })
          .optional(),
      }),
      d,
    ),
  )
  .handler(async ({ data }) => {
    const { mailboxes } = await signedIn()
    return mailboxes.save(data)
  })

/** A sender's choices about sending through their inbox: the workspace's mail server instead, and the most a day. */
export const setMailboxSendingFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; useServer?: boolean; dailyCap?: number }) =>
    validInput(
      z.object({
        id: z.string().min(1).max(100),
        useServer: z.boolean().optional(),
        dailyCap: z.number('Enter how many a day, a number.').int('Enter a whole number a day.').min(1, 'Send at least 1 a day.').max(150, 'A mailbox can send at most 150 a day here.').optional(),
      }),
      d,
    ),
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
