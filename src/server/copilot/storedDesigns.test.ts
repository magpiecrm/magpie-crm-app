import { beforeEach, describe, expect, it, vi } from 'vitest'

// The builder tools as outside AI apps get them: run against stored designs
// (in-memory campaigns, templates and surveys here) and saved as block designs.

const campaigns: Record<number, { id: number; name: string; subject: string; status: string; htmlContent: string }> = {}
const templates: Record<string, { id: string; name: string; description: string; html: string; updated_at: string }> = {}
const surveys: Record<string, any> = {}
const proposals: Record<string, { id: string; html: string }> = {}

vi.mock('../db', () => ({
  db: {
    getSurvey: (id: string) => surveys[id] ?? null,
    getSurveyResponses: () => [],
    getEmailTemplates: () => Object.values(templates),
  },
}))
vi.mock('../emailService', () => ({
  getCampaign: async (id: number) => {
    if (!campaigns[id]) throw new Error('Campaign not found')
    return { ...campaigns[id] }
  },
  updateCampaign: async (id: number, patch: { htmlContent?: string }) => {
    if (campaigns[id].status === 'sent') throw new Error('Cannot edit a campaign that has already been sent')
    campaigns[id].htmlContent = patch.htmlContent ?? campaigns[id].htmlContent
  },
}))
vi.mock('../emailTemplates', async (original) => ({
  ...(await original<typeof import('../emailTemplates')>()),
  getTemplateOrThrow: (id: string) => {
    if (!templates[id]) throw new Error(`No template "${id}"`)
    return templates[id]
  },
  updateTemplate: (id: string, patch: { html?: string }) => Object.assign(templates[id], patch),
}))
vi.mock('../sales', () => ({
  sales: {
    getProposal: (id: string) => {
      if (!proposals[id]) throw new Error('Proposal not found')
      return proposals[id]
    },
    updateProposal: (id: string, patch: { html?: string }) => Object.assign(proposals[id], patch),
  },
}))
vi.mock('../surveys', () => ({
  updateSurvey: (id: string, patch: { design?: unknown }) => Object.assign(surveys[id], patch.design ? { design: patch.design } : {}),
}))

const { STORED_DESIGN_TOOLS } = await import('./storedDesigns')
const { extractDesign } = await import('../../features/email-builder/utils/design')
const { executeTool } = await import('./mcp')

const ctx = { sessionId: 'public-mcp', getClientState: () => ({}), emitClientAction: () => { throw new Error('not in the browser') } }
async function call(name: string, args: Record<string, unknown>) {
  const tool = STORED_DESIGN_TOOLS.find((t) => t.name === name)!
  const out = await executeTool(tool, args, ctx, null)
  const text = out.content.find((c) => c.type === 'text')?.text ?? ''
  if (out.isError) throw new Error(text)
  return JSON.parse(text)
}

beforeEach(() => {
  for (const k of Object.keys(campaigns)) delete campaigns[Number(k)]
  for (const k of Object.keys(templates)) delete templates[k]
  for (const k of Object.keys(surveys)) delete surveys[k]
  for (const k of Object.keys(proposals)) delete proposals[k]
  campaigns[1] = { id: 1, name: 'October news', subject: 'News', status: 'draft', htmlContent: '' }
})

describe('builder tools on a stored design', () => {
  it('builds a campaign from a starter template and blocks, saved as a design the builder opens', async () => {
    const applied = await call('applyTemplate', { campaignId: 1, templateId: 'newsletter-editorial' })
    expect(applied.blockCount).toBeGreaterThan(0)
    await call('addBlock', { campaignId: 1, block: { type: 'text', content: 'Hello from outside' } })

    const design = extractDesign(campaigns[1].htmlContent)!
    expect(design.blocks).toHaveLength(applied.blockCount + 1)
    expect(design.blocks.at(-1)).toMatchObject({ type: 'text', content: 'Hello from outside' })
    // Reading it back sees the saved change.
    const read = await call('getBlocks', { campaignId: 1 })
    expect(read.blocks).toHaveLength(applied.blockCount + 1)
  })

  it('turns an old hand-written body into one block a template can replace', async () => {
    campaigns[1].htmlContent = '<p>Old markup</p>'
    expect((await call('getBlocks', { campaignId: 1 })).blocks).toEqual([{ id: 'imported_html', type: 'html', content: '<p>Old markup</p>' }])
    await call('applyTemplate', { campaignId: 1, templateId: 'newsletter-editorial' })
    expect(extractDesign(campaigns[1].htmlContent)!.blocks.some((b) => b.type === 'html')).toBe(false)
  })

  it('edits a saved template by savedTemplateId', async () => {
    templates.t1 = { id: 't1', name: 'Brand', description: '', html: '', updated_at: '' }
    await call('addBlock', { savedTemplateId: 't1', block: { type: 'text', content: 'In the template' } })
    expect(extractDesign(templates.t1.html)!.blocks).toEqual([expect.objectContaining({ type: 'text', content: 'In the template' })])
  })

  it("edits a proposal's page by proposalId", async () => {
    proposals.pr1 = { id: 'pr1', html: '' }
    await call('addBlock', { proposalId: 'pr1', block: { type: 'title', content: 'Our proposal' } })
    expect(extractDesign(proposals.pr1.html)!.blocks).toEqual([expect.objectContaining({ type: 'title', content: 'Our proposal' })])
    await expect(call('getBlocks', { proposalId: 'pr1', campaignId: 1 })).rejects.toThrow(/give one of/)
  })

  it("asks which design when it isn't clear, and leaves a sent campaign alone", async () => {
    await expect(call('getBlocks', {})).rejects.toThrow(/give one of campaignId .* savedTemplateId .* proposalId/)
    campaigns[1] = { ...campaigns[1], status: 'sent', htmlContent: '' }
    await expect(call('addBlock', { campaignId: 1, block: { type: 'text', content: 'x' } })).rejects.toThrow(/has been sent.*duplicateCampaign/)
    expect(campaigns[1].htmlContent).toBe('')
    // Reading a sent campaign's design is fine.
    expect((await call('getBlocks', { campaignId: 1 })).blocks).toEqual([])
  })

  it('edits a survey by surveyId', async () => {
    surveys.s1 = { id: 's1', name: 'Feedback', status: 'draft', design: { pages: [{ id: 'p1', blocks: [] }], theme: {} } }
    await call('addSurveyBlock', { surveyId: 's1', block: { type: 'heading', content: 'Tell us more' } })
    expect(surveys.s1.design.pages[0].blocks).toEqual([expect.objectContaining({ type: 'heading', content: 'Tell us more' })])
  })
})
