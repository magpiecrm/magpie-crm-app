import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The copilot's sequence tools, run the way the copilot and outside AI apps
// run them (executeTool), on a scratch database. Nothing is sent.

const scratchDir = mkdtempSync(join(tmpdir(), 'sequence-tools-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
vi.mock('../../nodemailer', () => ({ sendMail: vi.fn(async () => ({ messageId: 'x' })) }))

const { db } = await import('../../db')
const { executeTool, PUBLIC_TOOLS } = await import('../mcp')
const { getTool } = await import('.')
const { needsApproval } = await import('../permissions')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const ctx = { sessionId: 't', getClientState: () => ({ timeZone: 'America/New_York' }), emitClientAction: () => {} }
async function call(name: string, args: Record<string, unknown>) {
  const out = await executeTool(getTool(name)!, args, ctx, null)
  const text = out.content.find((c) => c.type === 'text')?.text ?? ''
  if (out.isError) throw new Error(text)
  return JSON.parse(text)
}

db.mutate((d) => {
  d.senders.push({ id: 7, name: 'Jo', email: 'jo@acme.test' })
  for (const [email, status] of [['ava@larkspur.test', 'subscribed'], ['ben@larkspur.test', 'subscribed'], ['gone@larkspur.test', 'unsubscribed']]) {
    d.contacts.push({ email, first_name: email.split('@')[0], last_name: 'Stone', job_title: '', company: 'Larkspur', status, created_at: new Date().toISOString() } as any)
  }
  d.lists.push({ id: 900, name: 'Agencies', created_at: '' } as any)
  d.list_contacts.push({ list_id: 900, contact_email: 'ava@larkspur.test' }, { list_id: 900, contact_email: 'gone@larkspur.test' })
})

describe('sequence tools', () => {
  it('drafts a sequence with its emails, in the user’s time zone, then previews and edits it', async () => {
    const s = await call('createSequence', {
      name: 'Agency founders',
      sender: 'jo@acme.test',
      emails: [
        { waitDays: 0, subject: 'Quick question, {{ contact.first_name }}', body: 'Hi {{ contact.first_name }}, one question.' },
        { waitDays: 3, subject: null, body: 'A new reason to reply.' },
      ],
      settings: { dailyCap: 30, signature: 'Jo, Acme' },
    })
    expect(s).toMatchObject({ name: 'Agency founders', status: 'draft', notReady: null, sender: 'Jo <jo@acme.test>' })
    expect(s.settings).toMatchObject({ time_zone: 'America/New_York', daily_cap: 30 })
    expect(s.emails.map((e: any) => e.subject)).toEqual(['Quick question, {{ contact.first_name }}', null])

    const preview = await call('previewSequenceEmail', { id: 'agency founders', step: 2, contactEmail: 'ava@larkspur.test' })
    expect(preview).toMatchObject({ subject: 'Re: Quick question, ava', contact: 'ava@larkspur.test' })
    expect(preview.text).toMatch(/^A new reason to reply\.\n\nJo, Acme\n\nNot interested\?/)

    // Editing keeps step 1 as it was (people on it stay on it) and adds a third.
    const firstId = db.data.sequences![0].steps[0].id
    const edited = await call('updateSequence', {
      id: s.id,
      emails: [
        { step: 1, waitDays: 0, subject: 'Quick question', body: 'Hi {{ contact.first_name }}.' },
        { step: 2, waitDays: 4, subject: null, body: 'Second.' },
        { waitDays: 5, subject: null, body: 'Last one.' },
      ],
    })
    expect(edited.emails.map((e: any) => e.waitDays)).toEqual([0, 4, 5])
    expect(db.data.sequences![0].steps[0].id).toBe(firstId)
  })

  it("says who'd be added from a list before adding them, then adds and manages them", async () => {
    const preview = await call('previewEnrollment', { id: 'Agency founders', listId: 900 })
    expect(preview).toEqual({ enrolled: 1, skipped: { unsubscribed: 1 } })
    expect(db.data.sequence_enrollments ?? []).toHaveLength(0)
    expect(await call('enrollInSequence', { id: 'Agency founders', emails: ['ava@larkspur.test', 'ben@larkspur.test'] })).toEqual({ enrolled: 2, skipped: {} })
    const people = await call('getEnrollments', { id: 'Agency founders' })
    expect(people.map((p: any) => [p.email, p.status, p.emailsSent])).toEqual(
      expect.arrayContaining([
        ['ava@larkspur.test', 'active', '0 of 3'],
        ['ben@larkspur.test', 'active', '0 of 3'],
      ]),
    )
    expect(await call('updateEnrollments', { id: 'Agency founders', emails: ['ben@larkspur.test', 'nobody@x.test'], action: 'mark_replied' })).toEqual({ changed: 1, notInSequence: 1 })
    expect((await call('getEnrollments', { id: 'Agency founders', status: 'replied' })).map((p: any) => p.email)).toEqual(['ben@larkspur.test'])
    const started = await call('setSequenceStatus', { id: 'Agency founders', status: 'active' })
    expect(started.status).toBe('active')
    expect((await call('getSequences', {}))[0]).toMatchObject({ name: 'Agency founders', enrolled: 2, replied: 1 })
  })

  it('asks before starting a sequence or enrolling people, and outside AI apps get the tools', () => {
    for (const name of ['setSequenceStatus', 'enrollInSequence']) expect(needsApproval(name, 'auto-safe')).toBe(true)
    for (const name of ['createSequence', 'updateSequence', 'previewEnrollment', 'getSequence', 'previewSequenceEmail']) expect(needsApproval(name, 'auto-safe')).toBe(false)
    expect(PUBLIC_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['getSequences', 'createSequence', 'enrollInSequence', 'getEnrollments', 'updateEnrollments']))
  })

  it('names the sequence it means when a name matches more than one', async () => {
    await call('createSequence', { name: 'Agency founders UK' })
    await expect(call('getSequence', { id: 'agency' })).rejects.toThrow(/More than one sequence matches/)
    await expect(call('getSequence', { id: 'nothing like it' })).rejects.toThrow(/No sequence matches/)
  })
})
