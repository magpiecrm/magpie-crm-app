import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Welcome emails on a real (scratch) database: each goes once, even when a
// run is still sending as the next minute's check comes round.

const scratchDir = mkdtempSync(join(tmpdir(), 'welcome-run-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://example.test'

const sent: string[] = []
vi.mock('./nodemailer', () => ({
  sendMail: vi.fn(async (msg: { to: string }) => {
    // Slow enough for a second run to start while this one is sending.
    await new Promise((r) => setTimeout(r, 20))
    sent.push(msg.to)
    return { messageId: 'x' }
  }),
}))

const { db } = await import('./db')
const emailService = await import('./emailService')
const { sendDueWelcomeEmails } = await import('./emailScheduler')

async function subscribed(emails: string[]) {
  const list = await emailService.createList(`List ${Math.random()}`)
  await emailService.addContactsToList(list.id, emails.map((email) => ({ email, attributes: {} }) as any))
}

beforeEach(() => {
  sent.length = 0
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('welcome emails that are due', () => {
  it('go once each when two runs overlap', async () => {
    await subscribed(['ana@acme.test', 'ben@acme.test'])
    db.addPendingEmail('ana@acme.test', 'Ana', 'Welcome', '<p>Hi</p>', -1000)
    db.addPendingEmail('ben@acme.test', 'Ben', 'Welcome', '<p>Hi</p>', -1000)

    await Promise.all([sendDueWelcomeEmails(), sendDueWelcomeEmails()])
    expect(sent.sort()).toEqual(['ana@acme.test', 'ben@acme.test'])

    // Nothing left for the next check.
    await sendDueWelcomeEmails()
    expect(sent).toHaveLength(2)
  })

  it('skip someone no longer on the contacts, and wait for those not due yet', async () => {
    await subscribed(['cy@acme.test'])
    db.addPendingEmail('gone@acme.test', 'Gone', 'Welcome', '<p>Hi</p>', -1000)
    db.addPendingEmail('cy@acme.test', 'Cy', 'Welcome', '<p>Hi</p>', 60 * 60_000)

    await sendDueWelcomeEmails()
    expect(sent).toEqual([])
    expect(db.getDuePendingEmails()).toEqual([])
  })

  it("go to someone a form didn't add to a list, unless they're a contact who unsubscribed or their address is stopped", async () => {
    await subscribed(['left@acme.test'])
    db.getContact('left@acme.test')!.status = 'unsubscribed'
    db.stopEmail('bounced@acme.test', 'bounced')
    for (const email of ['new@acme.test', 'left@acme.test', 'bounced@acme.test']) {
      db.addPendingEmail(email, '', 'Welcome', '<p>Hi</p>', -1000, undefined, { withoutContact: true })
    }

    await sendDueWelcomeEmails()
    expect(sent).toEqual(['new@acme.test'])
    expect(db.getDuePendingEmails()).toEqual([])
  })
})
