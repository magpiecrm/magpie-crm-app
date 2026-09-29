import { z } from 'zod'
import { defineTool } from '../types'
import { listRef, resolveListIds } from './shared'

const senderInput = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  id: z.number().int().optional(),
})

export const campaignTools = [
  defineTool({
    name: 'getCampaigns',
    description: 'List every campaign with its ID, subject, status, and target list.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { getCampaigns } = await import('../../emailService')
      const { campaigns } = await getCampaigns()
      return campaigns
    },
  }),

  defineTool({
    name: 'getCampaign',
    description:
      'Read one campaign in full, including its HTML body and delivery stats. Call this before editing an existing campaign so you modify the real content rather than rewriting from scratch. If the email builder is open for this same campaign, its htmlContent is the LAST SAVED version only — call getBlocks for what is actually on screen.',
    input: { id: z.number().int().describe('Campaign ID.') },
    target: 'server',
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const { getCampaign } = await import('../../emailService')
      const campaign = await getCampaign(id)

      // The builder holds edits in memory until an explicit save, so its live
      // state can differ from what this just read out of the database. A model
      // that calls getCampaign anyway (despite the system prompt steering it
      // toward getBlocks) would otherwise describe stale content with total
      // confidence — this makes that impossible to miss in the tool result
      // itself, not just an instruction it can ignore.
      const state = ctx.getClientState()
      if (state.builder && state.campaign?.id === id) {
        return {
          warning:
            `This campaign is currently open in the email builder with ${state.builder.blocks.length} unsaved ` +
            `block(s). The htmlContent below is only the last SAVED version and will not match what the user ` +
            `sees on screen. Call getBlocks instead before describing or editing the design.`,
          ...campaign,
        }
      }

      return campaign
    },
  }),

  defineTool({
    name: 'createCampaign',
    description:
      'Create a draft campaign. Does not send anything. Prefer building the design with the builder tools when the email builder is open; use `htmlContent` only when it is not.',
    input: {
      name: z.string().min(1).describe('Internal campaign name.'),
      subject: z.string().min(1).describe('Subject line the recipient sees.'),
      previewText: z.string().optional()
        .describe('Preheader shown after the subject in most inboxes.'),
      sender: senderInput.optional()
        .describe('Omit to use the default sender. Call getSenders first if unsure.'),
      htmlContent: z.string().optional(),
      lists: z.array(listRef).optional()
        .describe('Recipient lists. Required unless the campaign is a placeholder.'),
      unsubscribeEnabled: z.boolean().optional(),
      trackOpens: z.boolean().optional()
        .describe("Add a hidden image that records when each person opens the email (on unless false). In the UK and EU the sender needs recipients' consent for it (PECR/ePrivacy): turn it off for people found through prospect search or anyone who hasn't agreed."),
    },
    target: 'server',
    handler: async (args) => {
      const { createCampaign } = await import('../../emailService')
      const listIds = args.lists ? await resolveListIds(args.lists) : []
      return createCampaign({
        name: args.name.trim(),
        subject: args.subject.trim(),
        previewText: args.previewText,
        sender: args.sender,
        htmlContent: args.htmlContent ?? '',
        recipients: { listIds },
        unsubscribeEnabled: args.unsubscribeEnabled,
        trackOpens: args.trackOpens,
      })
    },
  }),

  defineTool({
    name: 'updateCampaign',
    description:
      'Change fields on an existing draft campaign. Only the fields you pass are altered. Sent campaigns cannot be edited.',
    input: {
      id: z.number().int(),
      name: z.string().min(1).optional(),
      subject: z.string().min(1).optional(),
      previewText: z.string().optional(),
      sender: senderInput.optional(),
      htmlContent: z.string().optional(),
      lists: z.array(listRef).optional(),
      unsubscribeEnabled: z.boolean().optional(),
      trackOpens: z.boolean().optional()
        .describe("Add a hidden image that records when each person opens the email (on unless false). In the UK and EU the sender needs recipients' consent for it (PECR/ePrivacy): turn it off for people found through prospect search or anyone who hasn't agreed."),
    },
    target: 'server',
    handler: async ({ id, lists, ...rest }, ctx) => {
      // The builder only flushes its edits into the wizard's own local state
      // when the user clicks Save & quit, and only the wizard's later submit
      // actually persists that to the database. A hand-written htmlContent
      // written here in between would look successful, then vanish the moment
      // the user finishes editing — with nothing telling them it happened.
      const state = ctx.getClientState()
      if (rest.htmlContent !== undefined && state.builder && state.campaign?.id === id) {
        throw new Error(
          'The email builder is open for this campaign, so writing htmlContent directly would be silently ' +
            'discarded the next time the user saves from the builder. Use getBlocks/updateBlock/replaceBlocks ' +
            'instead — those edit the live design the builder will actually save.',
        )
      }

      const { updateCampaign } = await import('../../emailService')
      const payload: Record<string, unknown> = { ...rest }
      if (lists) {
        const listIds = await resolveListIds(lists)
        if (listIds.length === 0) {
          throw new Error('None of the given lists could be resolved. Call getLists first.')
        }
        payload.recipients = { listIds }
      }
      await updateCampaign(id, payload as any)
      return { updated: id, fields: Object.keys(payload) }
    },
  }),

  defineTool({
    name: 'duplicateCampaign',
    description: 'Copy a campaign into a new draft. Useful as a starting point for a variant.',
    input: { id: z.number().int() },
    target: 'server',
    handler: async ({ id }) => {
      const { duplicateCampaign } = await import('../../emailService')
      return duplicateCampaign(id)
    },
  }),

  defineTool({
    name: 'deleteCampaign',
    description: 'Permanently delete a campaign and its recipient records.',
    input: { id: z.number().int() },
    target: 'server',
    destructive: true,
    handler: async ({ id }) => {
      const { deleteCampaign } = await import('../../emailService')
      await deleteCampaign(id)
      return { deleted: id }
    },
  }),

  defineTool({
    name: 'getCampaignStats',
    description:
      'Read delivery and engagement counts for one campaign — sent, opened, clicked, bounced, unsubscribed.',
    input: { id: z.number().int() },
    target: 'server',
    readOnly: true,
    handler: async ({ id }) => {
      const { getCampaignStats } = await import('../../emailService')
      return getCampaignStats(id)
    },
  }),
]
