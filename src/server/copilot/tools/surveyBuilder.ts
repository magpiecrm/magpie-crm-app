import { z } from 'zod'
import { defineTool } from '../types'
import type { CopilotClientState, ToolContext } from '../types'
import type { SurveyBlock, SurveyBlockType, SurveyDesign } from '../../../features/survey-builder/types'
import { SURVEY_BLOCK_TYPES } from '../../../features/survey-builder/types'
import { applySurveyBuilderAction, checkStructureLock, findBlock } from '../../../features/survey-builder/applyAction'

/**
 * Tools that edit the survey open in the survey builder. Like the email
 * builder tools, they validate against the browser's live (unsaved) design,
 * then emit `survey.*` client actions that the browser and the server's copy
 * of the design both apply with the same reducer.
 */

const blockTypes = SURVEY_BLOCK_TYPES.map(t => t.type) as [SurveyBlockType, ...SurveyBlockType[]]

/** Loose on purpose, as in the email builder tools: the prompt reference documents the real shape. */
const blockInput = z.looseObject({
  type: z.enum(blockTypes),
  content: z.string().optional().describe('Heading/text copy, image URL or raw HTML for content blocks.'),
  question: z
    .looseObject({ title: z.string() })
    .optional()
    .describe('For question types: { title, description?, required, placeholder?, options?: [{label}], allowOther?, scale?: {min,max,minLabel,maxLabel,icon}, mapTo?: {field, overwrite} }'),
})

const conditionInput = z
  .any()
  .describe(
    'A condition: { questionId, op, value? } where op is answered | not_answered | eq | neq | includes | not_includes | gt | gte | lt | lte and value is an option id (choice), number (rating/nps/scale/number) or boolean (yes_no). Combine with { all: [...] } or { any: [...] }.',
  )

const targetInput = z
  .union([z.object({ kind: z.literal('next') }), z.object({ kind: z.literal('end') }), z.object({ kind: z.literal('page'), pageId: z.string() })])
  .describe('{kind:"next"} | {kind:"end"} | {kind:"page", pageId} — jumps must go to a LATER page.')

function requireSurveyBuilder(state: CopilotClientState) {
  if (!state.surveyBuilder) {
    throw new Error(
      'The survey builder is not open, so there is no live survey design to edit. Use getSurvey/updateSurvey for surveys that are not open, or ask the user to open the survey in the builder.',
    )
  }
  return state.surveyBuilder
}

function currentDesign(state: CopilotClientState): SurveyDesign {
  const b = requireSurveyBuilder(state)
  return { pages: b.pages as SurveyDesign['pages'], theme: b.theme as unknown as SurveyDesign['theme'] }
}

/**
 * Apply the action to a scratch copy first, refusing it (with a message the
 * model can act on) if it breaks the structure lock, or if it changed nothing
 * — the usual sign of a wrong id.
 */
async function emitChecked(ctx: ToolContext, action: string, args: any, notFound?: string) {
  const state = ctx.getClientState()
  const before = currentDesign(state)
  const after = applySurveyBuilderAction(before, { action, args })
  if (notFound && JSON.stringify(after) === JSON.stringify(before)) throw new Error(notFound)

  if (state.survey?.hasResponses) {
    const { db } = await import('../../db')
    const saved = db.getSurvey(state.surveyBuilder!.surveyId)
    const violation = saved ? checkStructureLock(saved.design, after) : null
    if (violation) throw new Error(violation)
  }
  ctx.emitClientAction({ action, args })
  return after
}

function idsSummary(design: SurveyDesign) {
  return design.pages.map(p => ({ pageId: p.id, title: p.title, blockIds: p.blocks.map(b => `${b.id} (${b.type})`) }))
}

export const surveyBuilderTools = [
  defineTool({
    name: 'getSurveyDesign',
    description:
      'Read the survey open in the survey builder: every page, block, question, option id, logic rule and the theme, plus lint issues. Call this before editing so you use real ids.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async (_args, ctx) => {
      const state = ctx.getClientState()
      const design = currentDesign(state)
      const { lintSurvey } = await import('../../../features/survey-builder/logic/lint')
      const { db } = await import('../../db')
      return {
        survey: state.survey,
        selectedPageId: state.surveyBuilder?.selectedPageId ?? null,
        selectedBlockId: state.surveyBuilder?.selectedBlockId ?? null,
        ...design,
        issues: lintSurvey(design, undefined, db.getContactFields()),
      }
    },
  }),

  defineTool({
    name: 'listSurveyTemplates',
    description: 'List the starter survey templates (NPS, CSAT, product feedback, event feedback, lead qualification). Starting from one beats building from nothing.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { SURVEY_STARTER_TEMPLATES } = await import('../../../features/survey-builder/templates/starters')
      return SURVEY_STARTER_TEMPLATES.map(t => ({ id: t.id, name: t.name, category: t.category, description: t.description }))
    },
  }),

  defineTool({
    name: 'applySurveyTemplate',
    description: 'Replace every page of the open survey with a starter template. Discards the current pages — confirm with the user first if the survey has content.',
    input: { templateId: z.string() },
    target: 'client',
    destructive: true,
    handler: async ({ templateId }, ctx) => {
      requireSurveyBuilder(ctx.getClientState())
      const { SURVEY_STARTER_TEMPLATES } = await import('../../../features/survey-builder/templates/starters')
      const template = SURVEY_STARTER_TEMPLATES.find(t => t.id === templateId)
      if (!template) throw new Error(`Unknown template "${templateId}". Call listSurveyTemplates.`)
      const after = await emitChecked(ctx, 'survey.applyTemplate', { pages: template.build(), theme: template.theme })
      return { applied: template.name, pages: idsSummary(after) }
    },
  }),

  defineTool({
    name: 'addSurveyPage',
    description: 'Add a page. Omit index to append. Returns the new page id.',
    input: { title: z.string().optional(), index: z.number().int().min(0).optional() },
    target: 'client',
    handler: async ({ title, index }, ctx) => {
      requireSurveyBuilder(ctx.getClientState())
      const { newPageId } = await import('../../../features/survey-builder/applyAction')
      const page = { id: newPageId(), title, blocks: [] }
      await emitChecked(ctx, 'survey.addPage', { page, index })
      return { pageId: page.id }
    },
  }),

  defineTool({
    name: 'updateSurveyPage',
    description: 'Rename a page.',
    input: { pageId: z.string(), title: z.string() },
    target: 'client',
    handler: async ({ pageId, title }, ctx) => {
      await emitChecked(ctx, 'survey.updatePage', { id: pageId, updates: { title } }, `No page "${pageId}". Call getSurveyDesign.`)
      return { updated: pageId }
    },
  }),

  defineTool({
    name: 'deleteSurveyPage',
    description: 'Delete a page and its blocks. Rules pointing at it are removed. The last page cannot be deleted.',
    input: { pageId: z.string() },
    target: 'client',
    destructive: true,
    handler: async ({ pageId }, ctx) => {
      await emitChecked(ctx, 'survey.deletePage', { id: pageId }, `No page "${pageId}", or it is the only page.`)
      return { deleted: pageId }
    },
  }),

  defineTool({
    name: 'moveSurveyPage',
    description: 'Move a page up or down one place. Check logic afterwards — jumps must still go forward.',
    input: { pageId: z.string(), direction: z.enum(['up', 'down']) },
    target: 'client',
    handler: async ({ pageId, direction }, ctx) => {
      await emitChecked(ctx, 'survey.movePage', { id: pageId, direction }, `Page "${pageId}" can't move ${direction}.`)
      return { moved: pageId, direction }
    },
  }),

  defineTool({
    name: 'addSurveyBlock',
    description:
      'Add a question or content block to a page. Unspecified fields get sensible defaults (e.g. placeholder options). Returns the new block id and option ids.',
    input: {
      block: blockInput,
      pageId: z.string().optional().describe('Defaults to the last page.'),
      index: z.number().int().min(0).optional().describe('Position on the page. Omit to append.'),
    },
    target: 'client',
    handler: async ({ block, pageId, index }, ctx) => {
      const design = currentDesign(ctx.getClientState())
      const targetPage = pageId ?? design.pages[design.pages.length - 1]?.id
      if (!design.pages.some(p => p.id === targetPage)) throw new Error(`No page "${pageId}". Call getSurveyDesign.`)
      const { createSurveyBlock } = await import('../../../features/survey-builder/templates/blocks')
      const { normalizeBlock } = await import('../../../features/survey-builder/applyAction')
      const base = createSurveyBlock(block.type)
      const merged = normalizeBlock({
        ...base,
        ...(block as Partial<SurveyBlock>),
        id: base.id,
        ...(base.question || block.question ? { question: { ...base.question!, ...(block.question as object) } } : {}),
      })
      await emitChecked(ctx, 'survey.addBlock', { pageId: targetPage, index, block: merged })
      return { blockId: merged.id, pageId: targetPage, options: merged.question?.options }
    },
  }),

  defineTool({
    name: 'updateSurveyBlock',
    description:
      'Change fields of a block. `question` and `style` are merged, so send only what changes. To edit a single option use updateSurveyOption rather than resending the options array.',
    input: { blockId: z.string(), updates: z.looseObject({}) },
    target: 'client',
    handler: async ({ blockId, updates }, ctx) => {
      if (!findBlock(currentDesign(ctx.getClientState()), blockId)) throw new Error(`No block "${blockId}". Call getSurveyDesign.`)
      await emitChecked(ctx, 'survey.updateBlock', { id: blockId, updates })
      return { updated: blockId }
    },
  }),

  defineTool({
    name: 'deleteSurveyBlock',
    description: 'Delete a block. Logic rules that use it are removed too. Blocked for questions that already have responses.',
    input: { blockId: z.string() },
    target: 'client',
    destructive: true,
    handler: async ({ blockId }, ctx) => {
      await emitChecked(ctx, 'survey.deleteBlock', { id: blockId }, `No block "${blockId}". Call getSurveyDesign.`)
      return { deleted: blockId }
    },
  }),

  defineTool({
    name: 'moveSurveyBlock',
    description: 'Move a block one step within its page (direction), or to another page/position (toPageId + index).',
    input: {
      blockId: z.string(),
      direction: z.enum(['up', 'down']).optional(),
      toPageId: z.string().optional(),
      index: z.number().int().min(0).optional(),
    },
    target: 'client',
    handler: async ({ blockId, direction, toPageId, index }, ctx) => {
      await emitChecked(ctx, 'survey.moveBlock', { id: blockId, direction, toPageId, index }, `Block "${blockId}" did not move — check the ids.`)
      return { moved: blockId }
    },
  }),

  defineTool({
    name: 'addSurveyOption',
    description: 'Add an option to a choice question. Returns the new option id (needed for logic rules).',
    input: { blockId: z.string(), label: z.string(), index: z.number().int().min(0).optional() },
    target: 'client',
    handler: async ({ blockId, label, index }, ctx) => {
      const { newOptionId } = await import('../../../features/survey-builder/applyAction')
      const option = { id: newOptionId(), label }
      await emitChecked(ctx, 'survey.addOption', { blockId, option, index }, `No block "${blockId}".`)
      return { optionId: option.id }
    },
  }),

  defineTool({
    name: 'updateSurveyOption',
    description: "Relabel one option. The id stays the same, so existing answers and rules keep working.",
    input: { blockId: z.string(), optionId: z.string(), label: z.string() },
    target: 'client',
    handler: async ({ blockId, optionId, label }, ctx) => {
      await emitChecked(ctx, 'survey.updateOption', { blockId, optionId, updates: { label } }, `No option "${optionId}" on block "${blockId}".`)
      return { updated: optionId }
    },
  }),

  defineTool({
    name: 'deleteSurveyOption',
    description: 'Delete one option. Blocked when the survey already has responses.',
    input: { blockId: z.string(), optionId: z.string() },
    target: 'client',
    destructive: true,
    handler: async ({ blockId, optionId }, ctx) => {
      await emitChecked(ctx, 'survey.deleteOption', { blockId, optionId }, `No option "${optionId}" on block "${blockId}".`)
      return { deleted: optionId }
    },
  }),

  defineTool({
    name: 'moveSurveyOption',
    description: 'Move an option up or down one place.',
    input: { blockId: z.string(), optionId: z.string(), direction: z.enum(['up', 'down']) },
    target: 'client',
    handler: async ({ blockId, optionId, direction }, ctx) => {
      await emitChecked(ctx, 'survey.moveOption', { blockId, optionId, direction }, `Option "${optionId}" can't move ${direction}.`)
      return { moved: optionId }
    },
  }),

  defineTool({
    name: 'setSurveyPageLogic',
    description:
      "Replace a page's skip logic. Rules run in order after the page; the first match wins, otherwise defaultNext (or the next page). Rules may only use questions on this page or earlier, and only jump forward. Returns lint issues so you can fix mistakes.",
    input: {
      pageId: z.string(),
      rules: z.array(z.object({ when: conditionInput, goTo: targetInput })),
      defaultNext: targetInput.optional(),
    },
    target: 'client',
    handler: async ({ pageId, rules, defaultNext }, ctx) => {
      const design = currentDesign(ctx.getClientState())
      if (!design.pages.some(p => p.id === pageId)) throw new Error(`No page "${pageId}". Call getSurveyDesign.`)
      const after = await emitChecked(ctx, 'survey.setPageLogic', { pageId, rules, defaultNext })
      const { lintSurvey } = await import('../../../features/survey-builder/logic/lint')
      return { set: pageId, issues: lintSurvey(after).filter(i => i.pageId === pageId) }
    },
  }),

  defineTool({
    name: 'setSurveyTheme',
    description: 'Change theme keys (colours, font, radius, width, labels, logo). Only the keys you pass change. See the theme reference in the system prompt.',
    input: { updates: z.looseObject({}) },
    target: 'client',
    handler: async ({ updates }, ctx) => {
      await emitChecked(ctx, 'survey.setTheme', { updates })
      return { updated: Object.keys(updates) }
    },
  }),

  defineTool({
    name: 'undoSurveyChange',
    description: 'Roll the open survey back to before your last change. Use this instead of reconstructing the previous state by hand.',
    input: {},
    target: 'client',
    handler: async (_args, ctx) => {
      const { getSession, popSurveyDesignSnapshot } = await import('../state')
      const session = getSession(ctx.sessionId)
      if (!session) throw new Error('Copilot session has expired.')
      requireSurveyBuilder(session.clientState)
      const snapshot = popSurveyDesignSnapshot(session)
      if (!snapshot) throw new Error('There is nothing to undo — no survey change has been made this session.')
      ctx.emitClientAction({ action: 'survey.restoreDesign', args: { pages: snapshot.pages, theme: snapshot.theme } })
      return { undone: snapshot.label }
    },
  }),

  defineTool({
    name: 'previewSurvey',
    description: 'Render one page of the open survey to an image and look at it, to check layout, spacing and contrast. Defaults to the first page.',
    input: {
      pageId: z.string().optional(),
      width: z.number().int().min(320).max(1200).optional().describe('Viewport width. Defaults to 800; use 375 for mobile.'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ pageId, width }, ctx) => {
      const design = currentDesign(ctx.getClientState())
      const { renderEmailPng, renderUnavailableReason, RENDER_SETUP_HINT } = await import('../render')
      const unavailable = renderUnavailableReason()
      if (unavailable) throw new Error(`Image preview is unavailable (${unavailable}). Use getSurveyDesign instead, and tell the user: ${RENDER_SETUP_HINT}`)

      const { createElement } = await import('react')
      const { renderToStaticMarkup } = await import('react-dom/server')
      const { SurveyRenderer } = await import('../../../features/survey-builder/runtime/SurveyRenderer')
      const page = pageId ?? design.pages[0]?.id
      if (!design.pages.some(p => p.id === page)) throw new Error(`No page "${pageId}".`)
      const markup = renderToStaticMarkup(
        createElement(SurveyRenderer, { design, settings: { allowBack: true, thankYou: { title: '', message: '' } }, initialPath: [page!] }),
      )
      const png = await renderEmailPng(`<!doctype html><html><body style="margin:0">${markup}</body></html>`, width ?? 800)
      return { renderedAt: `${png.width}x${png.height}`, __image: { data: png.data, mimeType: 'image/png' } }
    },
  }),
]
