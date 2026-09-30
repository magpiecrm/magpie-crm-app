import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The copilot's deal, task and proposal tools, run the way the copilot and
// outside AI apps run them (executeTool), on a scratch database.

const scratchDir = mkdtempSync(join(tmpdir(), 'sales-tools-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { db } = await import('../../db')
const { sales } = await import('../../sales')
const { executeTool, PUBLIC_TOOLS } = await import('../mcp')
const { getTool } = await import('.')
const { needsApproval } = await import('../permissions')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const ctx = (timeZone?: string) => ({ sessionId: 't', getClientState: () => ({ timeZone }), emitClientAction: () => {} })
async function call(name: string, args: Record<string, unknown>, timeZone?: string) {
  const out = await executeTool(getTool(name)!, args, ctx(timeZone), null)
  const text = out.content.find((c) => c.type === 'text')?.text ?? ''
  if (out.isError) throw new Error(text)
  return JSON.parse(text)
}

db.mutate((d) => {
  d.contacts.push({ email: 'ava@larkspur.example', first_name: 'Ava', last_name: 'Stone', job_title: '', company: 'Larkspur', status: 'subscribed', created_at: new Date().toISOString() } as any)
})
const deal = sales.createDeal({ name: 'Larkspur pilot', value: 450000, contactEmails: ['ava@larkspur.example'] }, null)
sales.createDeal({ name: 'Northwind renewal' }, null)

describe('deal, task and proposal tools', () => {
  it('finds deals, and takes a deal by name where an id goes', async () => {
    const found = await call('getDeals', { search: 'larkspur' })
    expect(found).toEqual([expect.objectContaining({ id: deal.id, name: 'Larkspur pilot', value: '£4,500', stage: 'New lead' })])
    const task = await call('addTask', { task: 'Send the pilot terms', dealId: 'larkspur pilot' })
    expect(task).toMatchObject({ dealId: deal.id, about: 'Larkspur pilot', dueAt: null })
    await expect(call('addTask', { task: 'x', dealId: 'nothing like it' })).rejects.toThrow(/No deal matches/)
  })

  it("sets \"in N days\" for 9:00 in the user's time zone", async () => {
    const t = await call('addTask', { task: 'Follow up with Ava', dueInDays: 3, contactEmail: 'ava@larkspur.example' }, 'America/New_York')
    const local = new Date(t.dueAt).toLocaleString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
    expect(local).toBe('09:00')
    const done = await call('updateTask', { id: t.id, done: true })
    expect(done.done).toBe(true)
    const open = await call('getTasks', { contactEmail: 'ava@larkspur.example' })
    expect(open.tasks).toEqual([])
    expect((await call('getTasks', { contactEmail: 'ava@larkspur.example', includeDone: true })).tasks).toHaveLength(1)
  })

  it('makes a proposal from the layout, shares it, and reports on it', async () => {
    const p = await call('createProposal', { dealId: deal.id, title: 'Pilot proposal' })
    expect(sales.getProposal(p.id).html).toContain('£4,500')
    const shared = await call('shareProposal', { id: p.id })
    expect(shared.url).toMatch(/\/p\/[\w-]{32}$/)
    expect(shared.movedTo).toBe('Proposal sent')
    const [listed] = await call('getProposals', { dealId: 'Larkspur pilot' })
    expect(listed).toMatchObject({ id: p.id, title: 'Pilot proposal', opens: 0, acceptedAt: null })
    expect(listed.sentAt).toBeTruthy()
  })

  it('asks before emailing or deleting, and outside AI apps get the same tools', () => {
    for (const name of ['sendProposal', 'deleteProposal', 'deleteTask']) expect(needsApproval(name, 'auto-safe')).toBe(true)
    for (const name of ['addTask', 'createProposal', 'getDeals']) expect(needsApproval(name, 'auto-safe')).toBe(false)
    const names = PUBLIC_TOOLS.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['getDeals', 'getTasks', 'addTask', 'updateTask', 'createProposal', 'sendProposal', 'getProposals']))
    expect(PUBLIC_TOOLS.find((t) => t.name === 'addBlock')!.input).toHaveProperty('proposalId')
  })
})
