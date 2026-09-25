import { z } from 'zod'
import { defineTool } from '../types'
import { lintEmail } from '../lint'
import { collectBlockIds, findBlock } from '../../../features/email-builder/applyAction'

/**
 * Blocks are passed through as loose objects rather than mirrored into a Zod
 * schema. `EmailBlock` is a 21-variant union with per-type optional fields, and
 * duplicating it here would recreate exactly the drift this rewrite removes.
 * The generated tool reference derives the real shape from `types.ts`, and the
 * builder ignores unknown keys.
 */
const blockInput = z.looseObject({
  id: z.string().optional(),
  type: z.string().describe('One of the block types listed in the system prompt.'),
})

function requireBuilder(state: { builder?: { blocks: unknown[]; globalStyle: Record<string, unknown> } }) {
  if (!state.builder) {
    throw new Error(
      'The email builder is not open, so there is no live design to act on. Open a campaign in the builder, or use createCampaign/updateCampaign with htmlContent instead.',
    )
  }
  return state.builder
}


const collectionArg = z
  .enum(['items', 'links', 'socials', 'summaryRows'])
  .optional()
  .describe('Which sub-array to edit. Defaults to "items" (product/article/receipt/notice rows). Use "links"/"socials" for navigation and footer rows, "summaryRows" for receipt totals.')

/** Resolve a block and one of its sub-arrays, erroring usefully if either is wrong. */
function requireCollection(builder: any, blockId: string, collection: string) {
  const block: any = findBlock(builder.blocks, blockId)
  if (!block) {
    const ids = collectBlockIds(builder.blocks)
    throw new Error(`No block with id "${blockId}". Current block ids: ${ids.join(', ') || 'none'}.`)
  }
  const rows = block[collection]
  if (!Array.isArray(rows)) {
    throw new Error(
      `Block "${blockId}" (type ${block.type}) has no "${collection}" array. Call getBlocks to see what it holds.`,
    )
  }
  return { block, rows }
}

/**
 * A `survey` email block renders its first question from a snapshot. Fill it
 * in from the database so the model only has to name the survey — and fall
 * back to button mode when the first question can't be answered in an email.
 */
async function attachSurveySnapshot<B extends Record<string, unknown>>(block: B) {
  if (typeof block.surveyId !== 'string') throw new Error('A survey block needs a surveyId. Call getSurveys to find it.')
  const { db } = await import('../../db')
  const survey = db.getSurvey(block.surveyId)
  if (!survey) throw new Error(`No survey with id "${block.surveyId}". Call getSurveys.`)
  const { surveyEmailSnapshot } = await import('../../../features/survey-builder/utils/emailSnippet')
  const snapshot = surveyEmailSnapshot(survey.name, survey.design) ?? undefined
  const surveyMode = block.surveyMode === 'inline' && snapshot ? 'inline' : 'button'
  return { ...block, surveySnapshot: snapshot, surveyMode }
}

export const builderTools = [
  defineTool({
    name: 'getBlocks',
    description:
      'Read the design currently open in the email builder — every block and the global style. Call this before editing so you use real block IDs and never invent one.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async (_args, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      return {
        globalStyle: builder.globalStyle,
        selectedBlockId: (ctx.getClientState().builder as any)?.selectedBlockId ?? null,
        blocks: builder.blocks,
      }
    },
  }),

  defineTool({
    name: 'listTemplates',
    description:
      "List the built-in starter templates and the user's own saved templates (ids prefixed `saved:`), with a description of each. Starting from a template produces a far better design than assembling blocks from nothing — check here first whenever the user asks for a new email, and prefer the user's saved templates when one fits since they carry the user's own branding.",
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { STARTER_TEMPLATES } = await import(
        '../../../features/email-builder/templates/starters'
      )
      const { listTemplates } = await import('../../emailTemplates')
      return [
        ...listTemplates().map(t => ({
          id: `saved:${t.id}`,
          name: t.name,
          category: 'Saved',
          description: t.description,
        })),
        ...STARTER_TEMPLATES.map(t => ({
          id: t.id,
          name: t.name,
          category: t.category,
          description: t.description,
        })),
      ]
    },
  }),

  defineTool({
    name: 'applyTemplate',
    description:
      'Replace the open design with a starter or saved template, then adapt it with updateBlock/setGlobalStyle. Use listTemplates first to pick one.',
    input: {
      templateId: z.string().describe('An id from listTemplates, e.g. "newsletter-editorial" or "saved:<uuid>".'),
    },
    target: 'client',
    handler: async ({ templateId }, ctx) => {
      requireBuilder(ctx.getClientState())

      if (templateId.startsWith('saved:')) {
        const { getTemplateOrThrow } = await import('../../emailTemplates')
        const { extractDesign } = await import('../../../features/email-builder/utils/design')
        const saved = getTemplateOrThrow(templateId.slice('saved:'.length))
        const design = extractDesign(saved.html)
        if (!design) throw new Error(`Saved template "${saved.name}" has no block model, so it can't be applied to the builder.`)
        ctx.emitClientAction({ action: 'applyTemplate', args: design })
        return {
          applied: saved.name,
          blockCount: design.blocks.length,
          blocks: design.blocks.map(b => ({ id: b.id, type: b.type })),
        }
      }

      const { STARTER_TEMPLATES } = await import(
        '../../../features/email-builder/templates/starters'
      )
      const template = STARTER_TEMPLATES.find(t => t.id === templateId)
      if (!template) {
        const ids = STARTER_TEMPLATES.map(t => t.id).join(', ')
        throw new Error(`No template "${templateId}". Available: ${ids}.`)
      }
      const blocks = template.build()
      ctx.emitClientAction({
        action: 'applyTemplate',
        args: { blocks, globalStyle: template.globalStyle },
      })
      return {
        applied: template.name,
        blockCount: blocks.length,
        blocks: blocks.map(b => ({ id: b.id, type: b.type })),
      }
    },
  }),

  defineTool({
    name: 'addBlock',
    description: 'Insert a new block into the open design.',
    input: {
      block: blockInput,
      index: z.number().int().min(0).optional()
        .describe('Insert position. Appended to the end when omitted.'),
      parentId: z.string().optional()
        .describe('Id of a `section` block to nest this inside. Omit for a top-level block.'),
    },
    target: 'client',
    handler: async ({ block, index, parentId }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      if (parentId) {
        const ids = collectBlockIds(builder.blocks as any)
        if (!ids.includes(parentId)) {
          throw new Error(`No block with id "${parentId}" to nest inside. Current block ids: ${ids.join(', ') || 'none'}.`)
        }
      }
      const withSurvey = block.type === 'survey' ? await attachSurveySnapshot(block) : block
      ctx.emitClientAction({ action: 'addBlock', args: { block: withSurvey, index, parentId } })
      return { added: block.type, index: index ?? 'end', parentId: parentId ?? null }
    },
  }),

  defineTool({
    name: 'updateBlock',
    description:
      'Merge changes into one existing block. Prefer this over replaceBlocks when only a few things change.',
    input: {
      id: z.string().min(1).describe('Must match an id from getBlocks.'),
      updates: z.looseObject({}).describe('Partial block to merge, e.g. { "style": { "bgColor": "#111827" } }.'),
    },
    target: 'client',
    handler: async ({ id, updates }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      // Walks nested `section` children too, not just the top level.
      const ids = collectBlockIds(builder.blocks as any)
      if (!ids.includes(id)) {
        throw new Error(`No block with id "${id}". Current block ids: ${ids.join(', ') || 'none'}.`)
      }
      const target: any = findBlock(builder.blocks as any, id)
      const withSurvey =
        target?.type === 'survey' && ('surveyId' in updates || 'surveyMode' in updates)
          ? await attachSurveySnapshot({ ...target, ...updates }).then(({ surveySnapshot, surveyMode }) => ({ ...updates, surveySnapshot, surveyMode }))
          : updates
      ctx.emitClientAction({ action: 'updateBlock', args: { id, updates: withSurvey } })
      return { updated: id, fields: Object.keys(updates) }
    },
  }),

  defineTool({
    name: 'deleteBlock',
    description: 'Remove a block from the open design.',
    input: { id: z.string().min(1) },
    target: 'client',
    destructive: true,
    handler: async ({ id }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const ids = collectBlockIds(builder.blocks as any)
      if (!ids.includes(id)) {
        throw new Error(`No block with id "${id}". Current block ids: ${ids.join(', ') || 'none'}.`)
      }
      ctx.emitClientAction({ action: 'deleteBlock', args: { id } })
      return { deleted: id }
    },
  }),

  defineTool({
    name: 'moveBlock',
    description: 'Move a block one position up or down.',
    input: {
      id: z.string().min(1),
      direction: z.enum(['up', 'down']),
    },
    target: 'client',
    handler: async ({ id, direction }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const ids = collectBlockIds(builder.blocks as any)
      if (!ids.includes(id)) {
        throw new Error(`No block with id "${id}". Current block ids: ${ids.join(', ') || 'none'}.`)
      }
      ctx.emitClientAction({ action: 'moveBlock', args: { id, direction } })
      return { moved: id, direction }
    },
  }),

  defineTool({
    name: 'setGlobalStyle',
    description:
      'Change page-level styling — canvas width, background, default button colours, font, spacing. This is the right tool for "make the background dark" or "make the buttons green".',
    input: {
      updates: z.looseObject({})
        .describe('Partial global style, e.g. { "bodyBgColor": "#111827", "buttonBgColor": "#10b981" }.'),
    },
    target: 'client',
    handler: async ({ updates }, ctx) => {
      requireBuilder(ctx.getClientState())
      ctx.emitClientAction({ action: 'setGlobalStyle', args: { updates } })
      return { updated: Object.keys(updates) }
    },
  }),

  defineTool({
    name: 'replaceBlocks',
    description:
      'Replace the entire block list. Only for wholesale redesigns — for anything smaller use updateBlock or setGlobalStyle.',
    input: { blocks: z.array(blockInput) },
    target: 'client',
    destructive: true,
    handler: async ({ blocks }, ctx) => {
      requireBuilder(ctx.getClientState())
      ctx.emitClientAction({ action: 'replaceBlocks', args: { blocks } })
      return { blockCount: blocks.length }
    },
  }),


  defineTool({
    name: 'addItem',
    description:
      'Add one row to a block\'s sub-array — a product to a grid, a card to an article row, a line to a receipt, a link to a nav or footer. Use this instead of rewriting the whole array with updateBlock.',
    input: {
      blockId: z.string().min(1),
      collection: collectionArg,
      item: z.looseObject({}).describe('The new row, e.g. { "title": "Cap", "price": "£20", "image": "https://..." }.'),
      index: z.number().int().min(0).optional().describe('Position. Appended when omitted.'),
    },
    target: 'client',
    handler: async ({ blockId, collection, item, index }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const key = collection ?? 'items'
      const { rows } = requireCollection(builder, blockId, key)
      ctx.emitClientAction({ action: 'addItem', args: { blockId, collection: key, item, index } })
      return { blockId, collection: key, countWas: rows.length, countNow: rows.length + 1 }
    },
  }),

  defineTool({
    name: 'updateItem',
    description:
      'Change one row of a block\'s sub-array, leaving its siblings untouched. This is the right tool for "change the price of the second product".',
    input: {
      blockId: z.string().min(1),
      collection: collectionArg,
      itemId: z.string().min(1).describe('The row\'s id, from getBlocks.'),
      updates: z.looseObject({}).describe('Fields to merge into that row.'),
    },
    target: 'client',
    handler: async ({ blockId, collection, itemId, updates }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const key = collection ?? 'items'
      const { rows } = requireCollection(builder, blockId, key)
      if (!rows.some((r: any) => r?.id === itemId)) {
        const ids = rows.map((r: any) => r?.id).filter(Boolean).join(', ')
        throw new Error(`No row with id "${itemId}" in ${key} of "${blockId}". Row ids: ${ids || 'none'}.`)
      }
      ctx.emitClientAction({ action: 'updateItem', args: { blockId, collection: key, itemId, updates } })
      return { blockId, collection: key, itemId, fields: Object.keys(updates) }
    },
  }),

  defineTool({
    name: 'deleteItem',
    description: 'Remove one row from a block\'s sub-array.',
    input: {
      blockId: z.string().min(1),
      collection: collectionArg,
      itemId: z.string().min(1),
    },
    target: 'client',
    destructive: true,
    handler: async ({ blockId, collection, itemId }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const key = collection ?? 'items'
      const { rows } = requireCollection(builder, blockId, key)
      if (!rows.some((r: any) => r?.id === itemId)) {
        const ids = rows.map((r: any) => r?.id).filter(Boolean).join(', ')
        throw new Error(`No row with id "${itemId}" in ${key} of "${blockId}". Row ids: ${ids || 'none'}.`)
      }
      ctx.emitClientAction({ action: 'deleteItem', args: { blockId, collection: key, itemId } })
      return { blockId, collection: key, deleted: itemId }
    },
  }),

  defineTool({
    name: 'moveItem',
    description: 'Reorder one row within a block\'s sub-array.',
    input: {
      blockId: z.string().min(1),
      collection: collectionArg,
      itemId: z.string().min(1),
      direction: z.enum(['up', 'down']),
    },
    target: 'client',
    handler: async ({ blockId, collection, itemId, direction }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const key = collection ?? 'items'
      requireCollection(builder, blockId, key)
      ctx.emitClientAction({ action: 'moveItem', args: { blockId, collection: key, itemId, direction } })
      return { blockId, collection: key, moved: itemId, direction }
    },
  }),

  defineTool({
    name: 'undoLastChange',
    description:
      'Roll the design back to before your last change. Use this when you have made an edit that turned out wrong, rather than trying to reconstruct the previous state by hand.',
    input: {},
    target: 'client',
    handler: async (_args, ctx) => {
      const { getSession, popDesignSnapshot } = await import('../state')
      const session = getSession(ctx.sessionId)
      if (!session) throw new Error('Copilot session has expired.')
      requireBuilder(session.clientState)
      const snapshot = popDesignSnapshot(session)
      if (!snapshot) throw new Error('There is nothing to undo — no design change has been made this session.')
      ctx.emitClientAction({
        action: 'restoreDesign',
        args: { blocks: snapshot.blocks, globalStyle: snapshot.globalStyle },
      })
      return { undone: snapshot.label, blockCount: snapshot.blocks.length }
    },
  }),


  defineTool({
    name: 'previewEmail',
    description:
      'Render the open design to an image and look at it. Use this after building or restyling — the lint report catches broken markup, but only seeing it catches a heading colliding with an image, unreadable contrast, or a layout that falls apart on mobile. Render at 375px to check the phone view, which is where most marketing email is read.',
    input: {
      width: z.number().int().min(320).max(1200).optional()
        .describe('Viewport width in px. Defaults to 700 (desktop). Use 375 for mobile.'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ width }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const { compileHTML } = await import('../../../features/email-builder/utils/compiler')
      const { renderEmailPng, renderUnavailableReason, RENDER_SETUP_HINT } = await import('../render')

      const unavailable = renderUnavailableReason()
      if (unavailable) {
        throw new Error(
          `Image preview is unavailable (${unavailable}). Fall back to compileEmail's lint report, and tell the user: ${RENDER_SETUP_HINT}`,
        )
      }

      const html = compileHTML(builder.blocks as any, builder.globalStyle as any)
      const png = await renderEmailPng(html, width ?? 700)
      return {
        renderedAt: `${png.width}x${png.height}`,
        note: 'Look at the image and judge the layout, spacing, and contrast. Fix what is wrong with updateBlock/setGlobalStyle.',
        __image: { data: png.data, mimeType: 'image/png' },
      }
    },
  }),

  defineTool({
    name: 'compileEmail',
    description:
      'Compile the open design to email-client-safe HTML and lint it. Call this after a design change to check your own work — it reports missing alt text, a missing unsubscribe link, and CSS that Outlook drops.',
    input: {
      includeHtml: z.boolean().optional()
        .describe('Return the full HTML too. Defaults to false; the lint report is usually enough.'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ includeHtml }, ctx) => {
      const builder = requireBuilder(ctx.getClientState())
      const { compileHTML } = await import(
        '../../../features/email-builder/utils/compiler'
      )
      const html = compileHTML(builder.blocks as any, builder.globalStyle as any)
      const issues = lintEmail(builder.blocks as any, html)
      return {
        bytes: Buffer.byteLength(html, 'utf8'),
        issues,
        ...(includeHtml ? { html } : {}),
      }
    },
  }),
]
