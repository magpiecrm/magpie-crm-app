import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// db.ts reads DATABASE_PATH at import time, so point it at a scratch file first.
const scratchDir = mkdtempSync(join(tmpdir(), 'email-templates-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

vi.mock('./emailService', () => ({
  getCampaign: async (id: number) => {
    if (id !== 7) throw new Error('Campaign not found')
    return { id, htmlContent: '<p>campaign body</p>' }
  },
}))

const { db } = await import('./db')
const { createTemplate, updateTemplate, duplicateTemplate, deleteTemplate, listTemplates, getTemplateOrThrow } =
  await import('./emailTemplates')
const { extractDesign } = await import('../features/email-builder/utils/design')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.data.email_templates = []
})

describe('createTemplate', () => {
  it('compiles a starter into an editable design', async () => {
    const t = await createTemplate({ name: 'Weekly', starterId: 'newsletter-editorial' })
    const design = extractDesign(t.html)
    expect(design?.blocks.length).toBeGreaterThan(0)
    expect(t.description).toBe('')
  })

  it('starts blank with an empty but valid design', async () => {
    const t = await createTemplate({ name: '  ' })
    expect(t.name).toBe('Untitled template')
    expect(extractDesign(t.html)?.blocks).toEqual([])
  })

  it("copies a campaign's body", async () => {
    const t = await createTemplate({ name: 'From campaign', fromCampaignId: 7 })
    expect(t.html).toBe('<p>campaign body</p>')
  })

  it('rejects an unknown starter', async () => {
    await expect(createTemplate({ name: 'x', starterId: 'nope' })).rejects.toThrow(/Unknown starter/)
  })
})

describe('update / duplicate / delete', () => {
  it('keeps the old name when renamed to blank, and bumps updated_at', async () => {
    const t = await createTemplate({ name: 'Original', html: '<p>a</p>' })
    const before = t.updated_at
    await new Promise(r => setTimeout(r, 5))
    const updated = updateTemplate(t.id, { name: ' ', description: 'desc', html: '<p>b</p>' })
    expect(updated.name).toBe('Original')
    expect(updated.description).toBe('desc')
    expect(updated.html).toBe('<p>b</p>')
    expect(updated.updated_at > before).toBe(true)
  })

  it('duplicates under a new id and deletes', async () => {
    const t = await createTemplate({ name: 'A', html: '<p>a</p>' })
    const copy = duplicateTemplate(t.id)
    expect(copy.id).not.toBe(t.id)
    expect(copy.name).toBe('A (copy)')
    expect(listTemplates()).toHaveLength(2)

    deleteTemplate(t.id)
    expect(() => getTemplateOrThrow(t.id)).toThrow(/not found/)
    expect(() => deleteTemplate(t.id)).toThrow(/not found/)
    expect(listTemplates().map(x => x.id)).toEqual([copy.id])
  })
})
