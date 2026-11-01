import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Building lists from filters, run the way the copilot and outside AI apps run
// tools (executeTool), on a scratch database.

const scratchDir = mkdtempSync(join(tmpdir(), 'list-tools-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

vi.mock('../../notify', () => ({ notify: () => {} }))

const { db } = await import('../../db')
const { executeTool, PUBLIC_TOOLS } = await import('../mcp')
const { getTool } = await import('.')
const { needsApproval } = await import('../permissions')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const ctx = { sessionId: 't', getClientState: () => ({}), emitClientAction: () => {} }
async function call(name: string, args: Record<string, unknown>) {
  const out = await executeTool(getTool(name)!, args, ctx as any, null)
  const text = out.content.find((c) => c.type === 'text')?.text ?? ''
  if (out.isError) throw new Error(text)
  return JSON.parse(text)
}

const person = (name: string, job_title: string, country: string) =>
  ({ email: `${name}@${name}.test`, first_name: name, last_name: '', job_title, company: '', status: 'subscribed', created_at: '2026-01-01T00:00:00.000Z', company_id: null, country }) as any
const leaders = [
  { field: 'country', op: 'is_any', values: ['United Kingdom'] },
  { field: 'job_title', op: 'contains_any', values: ['CEO', 'Founder'] },
]
const members = (id: number) => db.data.list_contacts.filter((lc) => lc.list_id === id).map((lc) => lc.contact_email.split('@')[0])

beforeEach(() => {
  db.data.lists = [{ id: 1, name: 'Default', created_at: '' }]
  db.data.list_contacts = []
  db.data.contacts = [person('ana', 'CEO', 'United Kingdom'), person('ben', 'Founder', 'United Kingdom'), person('cat', 'Director', 'United Kingdom'), person('dan', 'CEO', 'France')]
})

describe('list building tools', () => {
  it('previews without making anything, in counts alone', async () => {
    const preview = await call('previewListFilters', { filters: leaders })
    expect(preview).toMatchObject({ matched: 2, toAdd: 2, canEmail: 2 })
    expect(JSON.stringify(preview)).not.toContain('@')
    expect(db.data.lists).toHaveLength(1)
  })

  it('makes the list it previewed', async () => {
    const { id, matched } = await call('createListFromFilters', { name: 'UK leaders', filters: leaders })
    expect(matched).toBe(2)
    expect(members(id)).toEqual(['ana', 'ben'])
    expect((await call('getLists', {})).find((l: any) => l.id === id)).toMatchObject({ name: 'UK leaders', builtFromFilters: true })
  })

  it('adds new matches to a list by name', async () => {
    const { id } = await call('createListFromFilters', { name: 'UK leaders', filters: leaders })
    db.data.contacts.push(person('eve', 'CEO', 'United Kingdom'))
    expect(await call('previewListFilters', { list: 'UK leaders' })).toMatchObject({ alreadyOn: 2, toAdd: 1 })
    expect(await call('addNewListMatches', { list: 'UK leaders' })).toMatchObject({ toAdd: 1 })
    expect(members(id)).toEqual(['ana', 'ben', 'eve'])
  })

  it("won't pick anyone from a filter it can't apply, and says why", async () => {
    await expect(call('createListFromFilters', { name: 'x', filters: [{ field: 'nothing', op: 'is_any', values: ['x'] }] })).rejects.toThrow("doesn't exist")
    await expect(call('previewListFilters', { filters: [{ field: 'country', op: 'is_any' }] })).rejects.toThrow('still needs a value')
    expect(db.data.lists).toHaveLength(1)
  })

  it('needs something to preview', async () => {
    await expect(call('previewListFilters', {})).rejects.toThrow('Pass filters')
  })

  it('asks before adding people, in every mode that asks about anything', () => {
    for (const tool of ['createListFromFilters', 'addNewListMatches']) {
      expect(needsApproval(tool, 'auto-safe')).toBe(true)
      expect(needsApproval(tool, 'ask')).toBe(true)
    }
    expect(needsApproval('previewListFilters', 'ask')).toBe(false)
    // Makes an empty list, so it's still safe to run. Filters mustn't reach it, as approval only sees the tool's name.
    expect(needsApproval('createList', 'auto-safe')).toBe(false)
    expect(Object.keys(getTool('createList')!.input)).toEqual(['name'])
  })

  it('offers them to outside AI apps', () => {
    const names = PUBLIC_TOOLS.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['previewListFilters', 'createListFromFilters', 'addNewListMatches']))
  })
})
