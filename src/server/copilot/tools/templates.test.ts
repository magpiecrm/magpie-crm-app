import { beforeEach, describe, expect, it, vi } from 'vitest'
import { templateTools } from './templates'
import { builderTools } from './builder'
import { COPILOT_TOOLS } from './index'
import type { CopilotClientState, ToolContext } from '../types'
import { compileHTML } from '../../../features/email-builder/utils/compiler'
import { DEFAULT_GLOBAL_STYLE } from '../../../features/email-builder/utils/design'

// Mirrors campaigns.test.ts: while the builder has a template open, its
// in-memory design is what gets saved, so the copilot must not write over it.

type Handler<Args> = (args: Args, ctx: ToolContext) => Promise<any>
const tool = <A,>(list: readonly { name: string; handler: unknown }[], name: string) =>
  list.find(t => t.name === name)!.handler as unknown as Handler<A>

const blocks = [{ id: 'b1', type: 'title', content: 'Hello' }]
const saved = {
  id: 't1',
  name: 'Brand newsletter',
  description: 'Ours',
  html: compileHTML(blocks as any, DEFAULT_GLOBAL_STYLE),
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const createTemplate = vi.fn(async (input: any) => ({ ...saved, id: 'new', name: input.name, html: input.html ?? '' }))
const updateTemplate = vi.fn((_id: string, _patch: unknown) => saved)
const deleteTemplate = vi.fn()
vi.mock('../../emailTemplates', async importOriginal => ({
  compileDesign: (await importOriginal<typeof import('../../emailTemplates')>()).compileDesign,
  listTemplates: () => [saved],
  getTemplateOrThrow: (id: string) => {
    if (id !== 't1') throw new Error('Template not found')
    return saved
  },
  createTemplate: (input: unknown) => createTemplate(input),
  updateTemplate: (id: string, patch: unknown) => updateTemplate(id, patch),
  duplicateTemplate: () => ({ ...saved, id: 't2', name: 'Brand newsletter (copy)' }),
  deleteTemplate: (id: string) => deleteTemplate(id),
}))

function ctxWith(state: CopilotClientState): ToolContext {
  return { sessionId: 'test', getClientState: () => state, emitClientAction: vi.fn() }
}

const builder = { blocks, globalStyle: DEFAULT_GLOBAL_STYLE as any }

beforeEach(() => vi.clearAllMocks())

describe('saved template CRUD', () => {
  it('lists with a block summary', async () => {
    const [row] = await tool<{}>(templateTools, 'getSavedTemplates')({}, ctxWith({}))
    expect(row).toMatchObject({ id: 't1', blockCount: 1, blockTypes: ['title'] })
  })

  it('saves the open design, and needs the builder to do so', async () => {
    const create = tool<any>(templateTools, 'createSavedTemplate')
    await create({ name: 'Mine', source: 'openDesign' }, ctxWith({ builder }))
    expect(createTemplate.mock.calls[0][0].html).toContain('BLOCKS_DATA')
    await expect(create({ name: 'Mine', source: 'openDesign' }, ctxWith({}))).rejects.toThrow(/not open/)
    await expect(create({ name: 'Mine', source: 'campaign' }, ctxWith({}))).rejects.toThrow(/campaignId/)
  })

  it('refuses to overwrite the template the builder has open, but allows renaming it', async () => {
    const update = tool<any>(templateTools, 'updateSavedTemplate')
    const open = ctxWith({ builder, template: { id: 't1', name: 'Brand newsletter' } })
    await expect(update({ id: 't1', fromOpenDesign: true }, open)).rejects.toThrow(/open on this template/)
    expect(updateTemplate).not.toHaveBeenCalled()
    await update({ id: 't1', name: 'Renamed' }, open)
    expect(updateTemplate).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'Renamed', html: undefined }))
  })

  it('will not delete the open template', async () => {
    const del = tool<any>(templateTools, 'deleteSavedTemplate')
    await expect(del({ id: 't1' }, ctxWith({ template: { id: 't1', name: 'x' } }))).rejects.toThrow(/open in the builder/)
    expect(await del({ id: 't1' }, ctxWith({}))).toEqual({ deleted: 'Brand newsletter' })
    expect(deleteTemplate).toHaveBeenCalledWith('t1')
  })
})

describe('listTemplates / applyTemplate with saved templates', () => {
  it('lists saved templates first, with a saved: prefix', async () => {
    const list = await tool<{}>(builderTools, 'listTemplates')({}, ctxWith({}))
    expect(list[0]).toMatchObject({ id: 'saved:t1', category: 'Saved' })
    expect(list.some((t: any) => t.id === 'newsletter-editorial')).toBe(true)
  })

  it('applies a saved template as a full design', async () => {
    const ctx = ctxWith({ builder: { blocks: [], globalStyle: {} } })
    const result = await tool<{ templateId: string }>(builderTools, 'applyTemplate')({ templateId: 'saved:t1' }, ctx)
    expect(result).toMatchObject({ applied: 'Brand newsletter', blockCount: 1 })
    expect(ctx.emitClientAction).toHaveBeenCalledWith({
      action: 'applyTemplate',
      args: { blocks, globalStyle: DEFAULT_GLOBAL_STYLE },
    })
  })
})

it('registers every template tool', () => {
  const names = COPILOT_TOOLS.map(t => t.name)
  for (const t of templateTools) expect(names).toContain(t.name)
})
