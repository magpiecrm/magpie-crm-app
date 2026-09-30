// The copilot's builder tools for outside AI apps (the public MCP server): the
// same tools, names and schemas, run against a stored design instead of one
// open in the browser. Each call names what it works on — a campaign or a
// saved template for an email, a proposal's page, a survey for a survey. The
// design is loaded, the tool runs exactly as it does in the copilot, its
// changes go through the
// same reducer the builder uses, and the result is saved as a block design
// the builder opens as normal (never as hand-written HTML).

import { z } from 'zod'
import { applyBuilderAction, type BuilderDesign } from '../../features/email-builder/applyAction'
import { applySurveyBuilderAction } from '../../features/survey-builder/applyAction'
import type { CopilotClientState, CopilotTool, ToolContext } from './types'
import { COPILOT_TOOLS } from './tools'
import { surveyBuilderTools } from './tools/surveyBuilder'

/** They rewind the copilot's own change history, which a stored design doesn't have. */
const LEFT_OUT = new Set(['undoLastChange', 'undoSurveyChange'])

const EMAIL_TOOLS = new Set([
  'getBlocks', 'applyTemplate', 'addBlock', 'updateBlock', 'deleteBlock', 'moveBlock', 'setGlobalStyle',
  'replaceBlocks', 'addItem', 'updateItem', 'deleteItem', 'moveItem', 'previewEmail', 'compileEmail', 'applyBrandToDesign',
])

/** A stored design, loaded for one call. */
interface Loaded<D> {
  design: D
  state: CopilotClientState
  /** Why it can't be changed (a sent campaign), or null. */
  readOnly: string | null
  save: (design: D) => Promise<void>
}

/** Stored email HTML as a design: its block model, or blank, or the old HTML as one `html` block to replace. */
async function emailDesign(html: string): Promise<BuilderDesign> {
  const { DEFAULT_GLOBAL_STYLE, extractDesign } = await import('../../features/email-builder/utils/design')
  const embedded = extractDesign(html)
  if (embedded) return embedded
  if (!html.trim()) return { blocks: [], globalStyle: DEFAULT_GLOBAL_STYLE }
  return { blocks: [{ id: 'imported_html', type: 'html', content: html } as any], globalStyle: DEFAULT_GLOBAL_STYLE }
}

async function loadEmail(campaignId: number | undefined, templateId: string | undefined, proposalId?: string): Promise<Loaded<BuilderDesign>> {
  if ([campaignId, templateId, proposalId].filter((x) => x !== undefined).length !== 1) {
    throw new Error('Say which design to work on: give one of campaignId (from getCampaigns), savedTemplateId (from getSavedTemplates) or proposalId (from getProposals).')
  }
  const { compileDesign } = await import('../emailTemplates')
  const compile = (d: BuilderDesign) => compileDesign(d.blocks, d.globalStyle)

  if (proposalId !== undefined) {
    const { sales } = await import('../sales')
    const proposal = sales.getProposal(proposalId)
    const design = await emailDesign(proposal.html)
    return {
      design,
      state: { builder: { ...design } as any },
      readOnly: null,
      save: async (d) => void sales.updateProposal(proposal.id, { html: compile(d) }),
    }
  }

  if (campaignId !== undefined) {
    const { getCampaign, updateCampaign } = await import('../emailService')
    const campaign = await getCampaign(campaignId).catch(() => null)
    if (!campaign) throw new Error(`No campaign ${campaignId}. Call getCampaigns for real IDs.`)
    const design = await emailDesign(campaign.htmlContent ?? '')
    return {
      design,
      state: { builder: { ...design } as any, campaign: { id: campaign.id, name: campaign.name, subject: campaign.subject } },
      readOnly: campaign.status === 'sent' ? `Campaign ${campaignId} has been sent, so its design can't change. duplicateCampaign makes an editable copy.` : null,
      save: async (d) => void (await updateCampaign(campaignId, { htmlContent: compile(d) })),
    }
  }

  const { getTemplateOrThrow, updateTemplate } = await import('../emailTemplates')
  const template = getTemplateOrThrow(templateId!)
  const design = await emailDesign(template.html)
  return {
    design,
    state: { builder: { ...design } as any, template: { id: template.id, name: template.name } },
    readOnly: null,
    save: async (d) => void updateTemplate(template.id, { html: compile(d) }),
  }
}

type SurveyDesign = { pages: any[]; theme: any }

async function loadSurvey(surveyId: string): Promise<Loaded<SurveyDesign>> {
  const { db } = await import('../db')
  const survey = db.getSurvey(surveyId)
  if (!survey) throw new Error(`No survey "${surveyId}". Call getSurveys for real IDs.`)
  const design: SurveyDesign = { pages: survey.design.pages as any[], theme: survey.design.theme }
  const hasResponses = db.getSurveyResponses(surveyId).length > 0
  return {
    design,
    state: {
      surveyBuilder: { surveyId, pages: design.pages, theme: design.theme },
      survey: { id: survey.id, name: survey.name, status: survey.status, hasResponses },
    },
    readOnly: null,
    save: async (d) => {
      const { updateSurvey } = await import('../surveys')
      updateSurvey(surveyId, { design: d as any })
    },
  }
}

/** Runs `tool` against a loaded design, then saves it if the tool changed it. */
async function runOn<D>(
  tool: CopilotTool<any>,
  args: unknown,
  outer: ToolContext,
  loaded: Loaded<D>,
  apply: (design: D, action: { action: string; args: any }) => D,
  stateOf: (design: D) => CopilotClientState,
): Promise<unknown> {
  let design = loaded.design
  let changed = false
  const ctx: ToolContext = {
    sessionId: outer.sessionId,
    getClientState: () => stateOf(design),
    emitClientAction: (action) => {
      if (loaded.readOnly) throw new Error(loaded.readOnly)
      design = apply(design, { action: action.action, args: action.args })
      changed = true
    },
  }
  const result = await tool.handler(args as any, ctx)
  if (changed) await loaded.save(design)
  return result
}

const CAMPAIGN_OR_TEMPLATE = {
  campaignId: z.number().int().optional().describe('The campaign whose design to work on (from getCampaigns). Give this or templateId.'),
  savedTemplateId: z.string().optional().describe('The saved template whose design to work on (from getSavedTemplates). Give this or campaignId.'),
  proposalId: z.string().optional().describe("A proposal's page (from getProposals), instead of an email. It's a web page, so it needs no unsubscribe link."),
}
const SURVEY = { surveyId: z.string().describe('The survey whose design to work on (from getSurveys).') }

/** The added arguments must never shadow a tool's own (applyTemplate already has a templateId). */
function withTarget(tool: CopilotTool<any>, target: Record<string, unknown>) {
  const clash = Object.keys(target).find((k) => k in tool.input)
  if (clash) throw new Error(`${tool.name} already takes "${clash}", so it can't also name its design that way.`)
  return { ...target, ...tool.input }
}

function onStoredEmail(tool: CopilotTool<any>): CopilotTool<any> {
  return {
    ...tool,
    target: 'server',
    browserOnly: false,
    description: `${tool.description} Here it works on the saved design of the campaign, template or proposal you name, and saves any change straight away.`,
    input: withTarget(tool, CAMPAIGN_OR_TEMPLATE),
    handler: async (all, outer) => {
      const { campaignId, savedTemplateId, proposalId, ...args } = all as { campaignId?: number; savedTemplateId?: string; proposalId?: string }
      const loaded = await loadEmail(campaignId, savedTemplateId, proposalId)
      return runOn(tool, args, outer, loaded, (d, a) => applyBuilderAction(d, a), (d) => ({ ...loaded.state, builder: { blocks: d.blocks, globalStyle: d.globalStyle as any } }))
    },
  }
}

function onStoredSurvey(tool: CopilotTool<any>): CopilotTool<any> {
  return {
    ...tool,
    target: 'server',
    browserOnly: false,
    description: `${tool.description} Here it works on the saved design of the survey you name, and saves any change straight away.`,
    input: withTarget(tool, SURVEY),
    handler: async (all, outer) => {
      const { surveyId, ...args } = all as { surveyId: string }
      const loaded = await loadSurvey(surveyId)
      return runOn(tool, args, outer, loaded, (d, a) => applySurveyBuilderAction(d as any, a) as any, (d) => ({
        ...loaded.state,
        surveyBuilder: { surveyId, pages: d.pages, theme: d.theme },
      }))
    },
  }
}

const SURVEY_BUILDER = new Set(surveyBuilderTools.map((t) => t.name).filter((n) => n !== 'listSurveyTemplates'))

/**
 * The builder tools, for the public MCP server. `listTemplates` and
 * `listSurveyTemplates` already work without a design, so they're shared as
 * they are rather than wrapped.
 */
export const STORED_DESIGN_TOOLS: CopilotTool<any>[] = COPILOT_TOOLS.flatMap((tool) => {
  if (LEFT_OUT.has(tool.name) || tool.name === 'listTemplates') return []
  if (EMAIL_TOOLS.has(tool.name)) return [onStoredEmail(tool)]
  if (SURVEY_BUILDER.has(tool.name)) return [onStoredSurvey(tool)]
  return []
})
