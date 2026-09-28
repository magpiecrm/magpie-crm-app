import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Campaign results on a real (scratch) database: every open and click is
// counted, links are tallied per person, and the totals and the per-recipient
// list agree.

const scratchDir = mkdtempSync(join(tmpdir(), 'campaign-activity-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://example.test'

vi.mock('./nodemailer', () => ({ sendMail: vi.fn(async () => ({ messageId: 'x' })) }))
vi.mock('./notify', () => ({ notify: () => {} }))

const { db } = await import('./db')
const emailService = await import('./emailService')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

async function sentCampaign(emails: string[]) {
  const list = await emailService.createList(`List ${Math.random()}`)
  await emailService.addContactsToList(list.id, emails.map((email) => ({ email, attributes: {} }) as any))
  const { id } = await emailService.createCampaign({
    name: 'Launch',
    subject: 'Hello',
    htmlContent: '<p>Hi <a href="https://acme.example/pricing">pricing</a></p>',
    sender: { name: 'Acme', email: 'hi@acme.test' },
    recipients: { listIds: [list.id] },
  })
  await emailService.sendCampaign(id)
  return id
}

describe('campaign activity', () => {
  it('counts every open and click, and who clicked which link', async () => {
    const id = await sentCampaign(['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test'])

    db.recordOpen('a@x.test', id)
    db.recordOpen('A@x.test ', id)
    db.recordClick('a@x.test', id, 'https://acme.example/pricing')
    db.recordClick('a@x.test', id, 'https://acme.example/pricing')
    // Images off: a click with no open still counts as opened.
    db.recordClick('b@x.test', id, 'https://acme.example/demo')
    db.recordClick('b@x.test', id, 'https://acme.example/pricing')
    db.updateRecipientBounceStatus('c@x.test', 'hard', String(id))
    // A bounced address can't open; a stray pixel load changes nothing.
    db.recordOpen('c@x.test', id)

    const { globalStats: s } = await emailService.getCampaignStats(id)
    expect(s).toMatchObject({
      sent: 4,
      delivered: 3,
      uniqueOpens: 2,
      uniqueClicks: 2,
      totalOpens: 2,
      totalClicks: 4,
      hardBounces: 1,
      openRate: 66.67,
      clickRate: 66.67,
    })

    const { recipients, links } = await emailService.getCampaignActivity(id)
    const a = recipients.find((r) => r.email === 'a@x.test')!
    expect(a).toMatchObject({ outcome: 'clicked', opens: 2, clicks: 2, links: [{ url: 'https://acme.example/pricing', clicks: 2 }] })
    expect(a.sentAt).toBeTruthy()
    expect(a.lastOpenedAt).toBeTruthy()
    expect(recipients.find((r) => r.email === 'b@x.test')).toMatchObject({ outcome: 'clicked', opens: 0, clicks: 2 })
    expect(recipients.find((r) => r.email === 'c@x.test')).toMatchObject({ outcome: 'bounced', bounce: 'hard', opens: 0 })
    expect(recipients.find((r) => r.email === 'd@x.test')).toMatchObject({ outcome: 'sent', opens: 0, clicks: 0 })

    expect(links).toEqual([
      { url: 'https://acme.example/pricing', clicks: 3, people: 2 },
      { url: 'https://acme.example/demo', clicks: 1, people: 1 },
    ])
  })

  it('keeps unsubscribes and spam complaints apart', async () => {
    const id = await sentCampaign(['e@x.test', 'f@x.test'])
    db.recordOpen('e@x.test', id)
    db.markRecipientUnsubscribed('e@x.test', id)
    db.markComplained('f@x.test')

    const { globalStats: s } = await emailService.getCampaignStats(id)
    expect(s).toMatchObject({ unsubscribed: 1, complaints: 1, uniqueOpens: 1 })

    const { recipients } = await emailService.getCampaignActivity(id)
    expect(recipients.find((r) => r.email === 'e@x.test')).toMatchObject({ outcome: 'unsubscribed', opens: 1 })
    const f = recipients.find((r) => r.email === 'f@x.test')!
    expect(f.outcome).toBe('complained')
    expect(f.unsubscribedAt).toBeTruthy()
    // An unsubscribe is final: a later click doesn't turn it back into "clicked".
    db.recordClick('e@x.test', id, 'https://acme.example/pricing')
    expect((await emailService.getCampaignActivity(id)).recipients.find((r) => r.email === 'e@x.test')?.outcome).toBe('unsubscribed')
  })

  it('reads rows saved before counts were kept', async () => {
    const id = await sentCampaign(['g@x.test'])
    const row = db.data.campaign_recipients.find((r) => r.campaign_id === id)!
    Object.assign(row, { status: 'clicked', opened_at: '2026-01-01T10:00:00Z', clicked_at: '2026-01-01T10:05:00Z' })
    delete row.opens
    delete row.clicks
    const { globalStats: s } = await emailService.getCampaignStats(id)
    expect(s).toMatchObject({ uniqueOpens: 1, uniqueClicks: 1, totalOpens: 1, totalClicks: 1 })
    db.recordOpen('g@x.test', id)
    expect(db.data.campaign_recipients.find((r) => r.campaign_id === id)?.opens).toBe(2)
  })
})
