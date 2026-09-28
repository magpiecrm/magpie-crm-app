import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

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

export const getSendersFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.getSenders()
  })

export const createSenderFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string; email: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const emailService = await import('../emailService')
    await requireAuth()
    return emailService.createSender(data.name, data.email)
  })

export const updateSenderFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: number; name: string; email: string }) => d)
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
    const { FIRST_GUESS_BATCH } = await import('../guessedRecipients')
    const members = new Set(db.data.list_contacts.filter((lc) => lc.list_id === data.listId).map((lc) => lc.contact_email))
    const subscribed = db.data.contacts.filter((c) => members.has(c.email) && c.status === 'subscribed')
    return { unconfirmed: subscribed.filter(isUnconfirmedGuess).length, total: subscribed.length, firstBatch: FIRST_GUESS_BATCH }
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
