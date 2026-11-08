import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Personas drafted from the workspace's own website: Claude's web tools, the
// website and the user's note only, and counted.

// Scratch database (usage counts are written to it), so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'persona-draft-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const ai = vi.hoisted(() => ({ state: { ok: true, web: true } as { ok: true; web: boolean } | { ok: false; reason: string } }))
vi.mock('../copilot/availability', () => ({ aiAvailable: () => ai.state }))

const { draftPersonas } = await import('./personaDraft')
const { AiUnavailable } = await import('../copilot/generate')
const { monthOf, usageForMonth } = await import('../usage')

const suggestion = {
  name: 'Operations leaders at logistics firms',
  description: 'Run the warehouses.',
  painPoints: 'Late shipments.',
  valueProp: 'Fewer of them.',
  criteria: { titles: ['Operations leaders', 'COO'], seniorities: [], industries: ['Truck Transportation'], companySizes: ['201-500', '51-200'], country: 'United Kingdom', keyword: '' },
}

beforeEach(() => {
  ai.state = { ok: true, web: true }
})

describe('draftPersonas', () => {
  it('reads the website with web tools, gives the AI nothing but the website and the note, and counts it', async () => {
    const before = usageForMonth(monthOf(new Date())).personaDrafts
    const generate = vi.fn(async (_opts: any) => ({ answer: { personas: [suggestion] }, web: true, model: 'm' }))
    const drafts = await draftPersonas({ websiteUrl: 'https://haulwise.test', note: 'Mostly UK hauliers' }, { generate: generate as any })

    const opts = generate.mock.calls[0][0]
    expect(opts.web).toEqual({ searches: 2, fetches: 4 })
    expect(opts.answer.name).toBe('suggestPersonas')
    expect(opts.prompt).toBe('Website: https://haulwise.test\n\nWhat they added about who they sell to:\nMostly UK hauliers')
    // Sizes come back in bucket order, as everywhere else.
    expect(drafts).toEqual([{ ...suggestion, criteria: { ...suggestion.criteria, companySizes: ['51-200', '201-500'] } }])
    expect(usageForMonth(monthOf(new Date())).personaDrafts).toBe(before + 1)
  })

  it("says why when there's no AI, or no web tools to read the website with", async () => {
    const generate = vi.fn()
    ai.state = { ok: false, reason: 'Add a key.' }
    await expect(draftPersonas({ websiteUrl: 'https://haulwise.test' }, { generate })).rejects.toThrow('Add a key.')
    ai.state = { ok: true, web: false }
    await expect(draftPersonas({ websiteUrl: 'https://haulwise.test' }, { generate })).rejects.toBeInstanceOf(AiUnavailable)
    expect(generate).not.toHaveBeenCalled()
  })
})
