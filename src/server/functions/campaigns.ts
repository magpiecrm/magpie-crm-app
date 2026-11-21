import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { validInput } from '../validInput'

export const campaignsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.getCampaigns()
  })

export const getCampaignFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.getCampaign(data.id)
  })

/** Who a sent campaign reached and what each of them did, plus clicks per link. */
export const getCampaignActivityFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: number }) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.getCampaignActivity(data.id)
  })

/** Every sender, and whether the workspace's mail server can send from it (where the host sends, its domain is set up). */
export const getSendersFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    const { env } = await import('../env')
    const { canSendFrom } = await import('../sendingDomains')
    await requireAuth()
    const { senders } = await emailService.getSenders()
    return { senders: senders.map((s) => ({ ...s, server_ready: !env.sendingManaged() || canSendFrom(s.email) })) }
  })

/** A sender's name and address: any address, now its domain needn't be set up first (emailService.createSender). */
const senderInput = z.object({
  name: z.string("Give the sender a name.").trim().max(200, 'Keep the name under 200 characters.'),
  email: z.string("Enter the sender's email address.").trim().toLowerCase().max(320, "That address is too long.").email("That isn't an email address."),
})

export const createSenderFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string; email: string }) => validInput(senderInput, d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.createSender(data.name, data.email)
  })

export const updateSenderFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number; name: string; email: string }) => validInput(senderInput.extend({ id: z.number().int() }), d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.updateSender(data.id, data.name, data.email)
  })

export const deleteSenderFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.deleteSender(data.id)
  })

export const createCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator((d: {
    name: string;
    subject?: string;
    previewText?: string;
    sender?: { name?: string; email?: string; id?: number };
    htmlContent?: string;
    recipients?: { listIds?: number[] };
    unsubscribeEnabled?: boolean;
    trackOpens?: boolean;
  }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.createCampaign(data)
  })

export const sendCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.sendCampaign(data.id)
  })

/**
 * Sends a sent campaign's held-back unverified recipients now
 * (guessedRecipients.ts), e.g. after the first batch bounced too much and the
 * user decides to go ahead anyway.
 */
export const sendHeldRecipientsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number }) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.sendCampaign(data.id, { releaseGuesses: true })
  })

/** How many subscribed contacts in a list have unverified prospected addresses, for a note before sending. */
export const unconfirmedInListFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { listId: number }) => z.object({ listId: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    const { isUnconfirmedGuess } = await import('../prospecting/types')
    const { prospectingRules } = await import('../prospecting/hostRules')
    const members = new Set(db.data.list_contacts.filter((lc) => lc.list_id === data.listId).map((lc) => lc.contact_email))
    const subscribed = db.data.contacts.filter((c) => members.has(c.email) && c.status === 'subscribed')
    const { firstBatch, holdHours, maxBounceRate } = prospectingRules()
    return { unconfirmed: subscribed.filter(isUnconfirmedGuess).length, total: subscribed.length, firstBatch, holdHours, maxBounceRate }
  })

/** How likely a campaign as drafted is to land in spam, and what to change (server/spamScore). */
export const campaignSpamScoreFn = createServerFn({ method: 'POST' })
  .inputValidator((d: {
    subject: string
    previewText?: string | null
    htmlContent: string
    senderId?: number | null
    listId?: number | null
    trackOpens: boolean
    unsubscribeEnabled: boolean
  }) =>
    z
      .object({
        subject: z.string().max(1000),
        previewText: z.string().max(2000).nullable().optional(),
        htmlContent: z.string().max(5_000_000),
        senderId: z.number().int().nullable().optional(),
        listId: z.number().int().nullable().optional(),
        trackOpens: z.boolean(),
        unsubscribeEnabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { campaignSpamScore } = await import('../spamScore')
    return campaignSpamScore(data)
  })

/** Takes a scheduled campaign off the schedule, back to a draft. */
export const unscheduleCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number }) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.unscheduleCampaign(data.id)
  })

export const sendTestEmailFn = createServerFn({ method: 'POST' })
  .inputValidator((d: {
    sender: { name: string; email: string };
    to: string[];
    subject: string;
    htmlContent: string;
    previewText?: string;
  }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.sendTestEmail(data)
  })

export const updateCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator((d: {
    id: number;
    name?: string;
    subject?: string;
    previewText?: string;
    sender?: { name?: string; email?: string; id?: number };
    htmlContent?: string;
    recipients?: { listIds: number[] };
    scheduledAt?: string;
    unsubscribeEnabled?: boolean;
    trackOpens?: boolean;
    batches?: { size: number; everyMinutes: number } | null;
  }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    const { id, ...payload } = data
    return emailService.updateCampaign(id, payload)
  })

export const deleteCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.deleteCampaign(data.id)
  })

export const duplicateCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.duplicateCampaign(data.id)
  })
