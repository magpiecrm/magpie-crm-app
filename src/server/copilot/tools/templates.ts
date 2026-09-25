import { z } from 'zod'
import { defineTool } from '../types'
import type { CopilotClientState } from '../types'
import type { EmailBlock, GlobalStyle } from '../../../features/email-builder/types'

/**
 * Saved templates: the user's own reusable designs, as opposed to the built-in
 * starters that `listTemplates` also returns. Stored as compiled HTML with the
 * block model embedded, so `extractDesign` recovers an editable design.
 */

async function summarize(template: { id: string; name: string; description: string; html: string; updated_at: string }) {
  const { extractDesign } = await import('../../../features/email-builder/utils/design')
  const design = extractDesign(template.html)
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    updatedAt: template.updated_at,
    blockCount: design?.blocks.length ?? null,
    blockTypes: design ? design.blocks.map(b => b.type) : null,
  }
}

/** Compile whatever design the builder has open — campaign or template. */
async function compileOpenDesign(state: CopilotClientState) {
  if (!state.builder) {
    throw new Error('The email builder is not open, so there is no design to save. Use source "starter", "campaign", or "blank" instead.')
  }
  const { compileDesign } = await import('../../emailTemplates')
  return compileDesign(state.builder.blocks as EmailBlock[], state.builder.globalStyle as Partial<GlobalStyle>)
}

export const templateTools = [
  defineTool({
    name: 'getSavedTemplates',
    description:
      "List the user's saved email templates (their own reusable designs) with id, name, description and the block types each contains. To put one on the canvas, call applyTemplate with `saved:<id>`.",
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { listTemplates } = await import('../../emailTemplates')
      return Promise.all(listTemplates().map(summarize))
    },
  }),

  defineTool({
    name: 'getSavedTemplate',
    description: 'Read one saved template in full, including its blocks and global style.',
    input: { id: z.string().describe('Template id from getSavedTemplates.') },
    target: 'server',
    readOnly: true,
    handler: async ({ id }) => {
      const { getTemplateOrThrow } = await import('../../emailTemplates')
      const { extractDesign } = await import('../../../features/email-builder/utils/design')
      const template = getTemplateOrThrow(id)
      const design = extractDesign(template.html)
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        updatedAt: template.updated_at,
        ...(design
          ? { blocks: design.blocks, globalStyle: design.globalStyle }
          : { note: 'This template was not made in the builder, so it has no block model. Raw HTML follows.', html: template.html }),
      }
    },
  }),

  defineTool({
    name: 'createSavedTemplate',
    description:
      'Save a reusable email template. `source` picks where the design comes from: "openDesign" (whatever is on the builder canvas now, including unsaved edits), "campaign" (a campaign\'s saved body — needs campaignId), "starter" (a built-in layout — needs starterId from listTemplates), or "blank".',
    input: {
      name: z.string().min(1),
      description: z.string().optional(),
      source: z.enum(['openDesign', 'campaign', 'starter', 'blank']),
      campaignId: z.number().int().optional(),
      starterId: z.string().optional(),
    },
    target: 'server',
    handler: async ({ name, description, source, campaignId, starterId }, ctx) => {
      const { createTemplate } = await import('../../emailTemplates')
      let template
      switch (source) {
        case 'openDesign':
          template = await createTemplate({ name, description, html: await compileOpenDesign(ctx.getClientState()) })
          break
        case 'campaign':
          if (campaignId === undefined) throw new Error('source "campaign" needs campaignId. Call getCampaigns to find it.')
          template = await createTemplate({ name, description, fromCampaignId: campaignId })
          break
        case 'starter':
          if (!starterId) throw new Error('source "starter" needs starterId. Call listTemplates to find one.')
          template = await createTemplate({ name, description, starterId })
          break
        case 'blank':
          template = await createTemplate({ name, description })
          break
      }
      return summarize(template)
    },
  }),

  defineTool({
    name: 'updateSavedTemplate',
    description:
      "Rename a saved template, change its description, or overwrite its design with what is on the builder canvas now (`fromOpenDesign: true`). When the builder is open on this template, don't overwrite it here — edit with the builder tools and let the user save.",
    input: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      fromOpenDesign: z.boolean().optional(),
    },
    target: 'server',
    handler: async ({ id, name, description, fromOpenDesign }, ctx) => {
      const state = ctx.getClientState()
      // Same trap as updateCampaign: the builder saves its own in-memory copy
      // over whatever is written here the next time the user clicks save.
      if (fromOpenDesign && state.template?.id === id) {
        throw new Error(
          'The builder is open on this template, so its edits are saved when the user clicks Save & quit. ' +
            'Writing the design here would be overwritten by that save. Edit with the builder tools instead.',
        )
      }
      const { updateTemplate } = await import('../../emailTemplates')
      const html = fromOpenDesign ? await compileOpenDesign(state) : undefined
      return summarize(updateTemplate(id, { name, description, html }))
    },
  }),

  defineTool({
    name: 'duplicateSavedTemplate',
    description: 'Copy a saved template under the name "<name> (copy)".',
    input: { id: z.string() },
    target: 'server',
    handler: async ({ id }) => {
      const { duplicateTemplate } = await import('../../emailTemplates')
      return summarize(duplicateTemplate(id))
    },
  }),

  defineTool({
    name: 'deleteSavedTemplate',
    description: 'Permanently delete a saved template. Campaigns created from it are unaffected.',
    input: { id: z.string() },
    target: 'server',
    destructive: true,
    handler: async ({ id }, ctx) => {
      if (ctx.getClientState().template?.id === id) {
        throw new Error('This template is open in the builder. Ask the user to close it before deleting.')
      }
      const { deleteTemplate, getTemplateOrThrow } = await import('../../emailTemplates')
      const { name } = getTemplateOrThrow(id)
      deleteTemplate(id)
      return { deleted: name }
    },
  }),
]
