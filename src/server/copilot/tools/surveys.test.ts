import { describe, expect, it, vi } from 'vitest'
import { surveyTools } from './surveys'
import { surveyBuilderTools } from './surveyBuilder'
import { COPILOT_TOOLS } from './index'
import type { CopilotClientState, ToolContext } from '../types'
import { DEFAULT_SURVEY_SETTINGS, DEFAULT_SURVEY_THEME } from '../../../features/survey-builder/types'

// Same reasoning as campaigns.test.ts: the survey builder keeps edits in
// memory until the user saves, so the copilot must neither describe the stale
// saved copy as current nor write a design that the next save would discard.

type Handler<Args> = (args: Args, ctx: ToolContext) => Promise<any>
const tool = <A,>(list: readonly { name: string; handler: unknown }[], name: string) =>
  list.find(t => t.name === name)!.handler as unknown as Handler<A>

const design = {
  theme: DEFAULT_SURVEY_THEME,
  pages: [{ id: 'p1', blocks: [{ id: 'q1', type: 'yes_no', question: { title: 'Q', required: false } }] }],
}
const saved = { id: 's1', name: 'Saved', status: 'draft', design, settings: DEFAULT_SURVEY_SETTINGS }

const updateSurvey = vi.fn().mockReturnValue(saved)
vi.mock('../../surveys', () => ({
  getSurveyOrThrow: () => saved,
  updateSurvey: (...args: unknown[]) => updateSurvey(...args),
}))
vi.mock('../../db', () => ({
  db: { getSurveyResponseCount: () => 3, getSurvey: () => saved, getContactFields: () => [] },
}))

function ctxWith(state: CopilotClientState): ToolContext {
  return { sessionId: 'test', getClientState: () => state, emitClientAction: vi.fn() }
}

const openBuilder = (hasResponses = false): CopilotClientState => ({
  survey: { id: 's1', name: 'Saved', status: 'draft', hasResponses },
  surveyBuilder: { surveyId: 's1', pages: design.pages, theme: design.theme as any },
})

describe('getSurvey / updateSurvey with the builder open', () => {
  it('warns that the saved copy may be stale', async () => {
    const result = await tool<{ id: string }>(surveyTools, 'getSurvey')({ id: 's1' }, ctxWith(openBuilder()))
    expect(result.warning).toMatch(/getSurveyDesign/)
    expect(result.responseCount).toBe(3)
    expect((await tool<{ id: string }>(surveyTools, 'getSurvey')({ id: 's1' }, ctxWith({}))).warning).toBeUndefined()
  })

  it('refuses to write a design over the open builder, but allows settings', async () => {
    const update = tool<{ id: string; design?: unknown; name?: string }>(surveyTools, 'updateSurvey')
    await expect(update({ id: 's1', design }, ctxWith(openBuilder()))).rejects.toThrow(/survey builder is open/)
    expect(updateSurvey).not.toHaveBeenCalled()
    await update({ id: 's1', name: 'Renamed' }, ctxWith(openBuilder()))
    expect(updateSurvey).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'Renamed' }))
  })
})

describe('survey builder tools', () => {
  it('emit namespaced actions', async () => {
    const ctx = ctxWith(openBuilder())
    const result = await tool<any>(surveyBuilderTools, 'addSurveyBlock')({ block: { type: 'nps' }, pageId: 'p1' }, ctx)
    expect(result.blockId).toBeTruthy()
    expect(ctx.emitClientAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey.addBlock' }))
  })

  it('reject unknown ids and structural edits once responses exist', async () => {
    await expect(tool<any>(surveyBuilderTools, 'deleteSurveyBlock')({ blockId: 'nope' }, ctxWith(openBuilder()))).rejects.toThrow(/No block/)
    await expect(tool<any>(surveyBuilderTools, 'deleteSurveyBlock')({ blockId: 'q1' }, ctxWith(openBuilder(true)))).rejects.toThrow(/can't be deleted/)
  })

  it('require the builder to be open', async () => {
    await expect(tool<any>(surveyBuilderTools, 'getSurveyDesign')({}, ctxWith({}))).rejects.toThrow(/not open/)
  })
})

it('registers every survey tool without name clashes', () => {
  const names = COPILOT_TOOLS.map(t => t.name)
  for (const t of [...surveyTools, ...surveyBuilderTools]) expect(names).toContain(t.name)
})
