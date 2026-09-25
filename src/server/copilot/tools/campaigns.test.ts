import { describe, expect, it, vi } from 'vitest'
import { campaignTools } from './campaigns'
import type { CopilotClientState, ToolContext } from '../types'

// The builder holds edits in memory until an explicit save, so the database's
// campaign row can lag behind what the user is actually looking at. These
// pin down that getCampaign/updateCampaign make that gap impossible to miss
// or silently step on, rather than relying only on the system prompt saying
// "prefer getBlocks" — a model can ignore an instruction; it can't ignore
// what's in the tool result it just received.

// campaignTools is a heterogeneous array (each tool has its own Zod input
// shape), so `.find()` collapses the handler's argument type to an
// intersection of every shape in the array. Recast to what each handler
// actually takes rather than fighting that at every call site below.
type Handler<Args> = (args: Args, ctx: ToolContext) => Promise<unknown>

const getCampaignHandler = campaignTools.find((t) => t.name === 'getCampaign')!
  .handler as unknown as Handler<{ id: number }>
const updateCampaignHandler = campaignTools.find((t) => t.name === 'updateCampaign')!
  .handler as unknown as Handler<{ id: number; htmlContent?: string; subject?: string }>

const fakeCampaign = { id: 1, name: 'Test', subject: 'Hi', htmlContent: '<p>old</p>' }

vi.mock('../../emailService', () => ({
  getCampaign: vi.fn().mockResolvedValue(fakeCampaign),
  updateCampaign: vi.fn().mockResolvedValue(undefined),
}))

function ctxWith(state: CopilotClientState): ToolContext {
  return { sessionId: 'test', getClientState: () => state, emitClientAction: vi.fn() }
}

describe('getCampaign', () => {
  it('returns the campaign as-is when the builder is not open', async () => {
    const result: any = await getCampaignHandler({ id: 1 }, ctxWith({}))
    expect(result).toEqual(fakeCampaign)
    expect(result.warning).toBeUndefined()
  })

  it('returns the campaign as-is when the builder is open for a DIFFERENT campaign', async () => {
    const state: CopilotClientState = {
      campaign: { id: 2, name: 'Other' },
      builder: { blocks: [{ id: 'a', type: 'title' }], globalStyle: {} },
    }
    const result: any = await getCampaignHandler({ id: 1 }, ctxWith(state))
    expect(result.warning).toBeUndefined()
    expect(result.htmlContent).toBe('<p>old</p>')
  })

  it('attaches a warning when the builder has THIS campaign open', async () => {
    const state: CopilotClientState = {
      campaign: { id: 1, name: 'Test' },
      builder: { blocks: [{ id: 'a', type: 'title' }, { id: 'b', type: 'button' }], globalStyle: {} },
    }
    const result: any = await getCampaignHandler({ id: 1 }, ctxWith(state))

    expect(result.warning).toMatch(/2 unsaved/)
    expect(result.warning).toMatch(/getBlocks/)
    // The underlying (stale) data must still be there — this is a warning,
    // not a redaction; the model should still see what was last saved.
    expect(result.htmlContent).toBe('<p>old</p>')
  })
})

describe('updateCampaign', () => {
  it('writes htmlContent normally when the builder is not open', async () => {
    const { updateCampaign } = await import('../../emailService')
    const result: any = await updateCampaignHandler(
      { id: 1, htmlContent: '<p>new</p>' },
      ctxWith({}),
    )
    expect(updateCampaign).toHaveBeenCalledWith(1, expect.objectContaining({ htmlContent: '<p>new</p>' }))
    expect(result.updated).toBe(1)
  })

  it('refuses to overwrite htmlContent while the builder holds this campaign', async () => {
    const state: CopilotClientState = {
      campaign: { id: 1, name: 'Test' },
      builder: { blocks: [], globalStyle: {} },
    }
    await expect(
      updateCampaignHandler({ id: 1, htmlContent: '<p>new</p>' }, ctxWith(state)),
    ).rejects.toThrow(/silently discarded/)
  })

  it('still allows non-html fields (name, subject) while the builder is open', async () => {
    const { updateCampaign } = await import('../../emailService')
    vi.mocked(updateCampaign).mockClear()
    const state: CopilotClientState = {
      campaign: { id: 1, name: 'Test' },
      builder: { blocks: [], globalStyle: {} },
    }
    const result: any = await updateCampaignHandler({ id: 1, subject: 'New subject' }, ctxWith(state))
    expect(updateCampaign).toHaveBeenCalledWith(1, expect.objectContaining({ subject: 'New subject' }))
    expect(result.updated).toBe(1)
  })

  it('does not refuse htmlContent writes to a DIFFERENT campaign than the one open', async () => {
    const { updateCampaign } = await import('../../emailService')
    vi.mocked(updateCampaign).mockClear()
    const state: CopilotClientState = {
      campaign: { id: 2, name: 'Other' },
      builder: { blocks: [], globalStyle: {} },
    }
    const result: any = await updateCampaignHandler({ id: 1, htmlContent: '<p>new</p>' }, ctxWith(state))
    expect(updateCampaign).toHaveBeenCalled()
    expect(result.updated).toBe(1)
  })
})
