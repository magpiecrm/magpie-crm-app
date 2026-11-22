import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// "Send a test" from the campaign preview: the subject is marked as a test once,
// by the server, however the page sent it.

const scratchDir = mkdtempSync(join(tmpdir(), 'test-email-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://example.test'

const sent: Array<{ to: string; subject: string }> = []
vi.mock('./nodemailer', () => ({
  sendMail: vi.fn(async (msg: { to: string; subject: string }) => {
    sent.push({ to: msg.to, subject: msg.subject })
    return { messageId: 'x' }
  }),
}))

const { sendTestEmail, testSubject } = await import('./emailService')

const sender = { name: 'Acme', email: 'hi@acme.test' }

beforeEach(() => {
  sent.length = 0
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('test emails', () => {
  it('carry one [TEST] mark, with the subject merged', async () => {
    await sendTestEmail({ sender, to: ['jo@acme.test'], subject: 'Hello {{ contact.first_name }}', htmlContent: '<p>Hi</p>' })
    expect(sent).toEqual([{ to: 'jo@acme.test', subject: '[TEST] Hello TestFirstName' }])
  })

  it("aren't marked twice by a page that marked the subject itself", async () => {
    await sendTestEmail({ sender, to: ['jo@acme.test'], subject: '[TEST] Spring offer', htmlContent: '<p>Hi</p>' })
    expect(sent[0].subject).toBe('[TEST] Spring offer')
  })

  it('say so when there is no subject', () => {
    expect(testSubject('')).toBe('[TEST] No subject')
    expect(testSubject('  [TEST]  ')).toBe('[TEST] No subject')
    expect(testSubject('[test] [TEST] Hi')).toBe('[TEST] Hi')
  })
})
