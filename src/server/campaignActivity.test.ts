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

/** A time `seconds` after now: clicks by people come a while after the email was sent. */
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()

describe('campaign activity', () => {
  it('counts every open and click, and who clicked which link', async () => {
    const id = await sentCampaign(['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test'])

    db.recordOpen('a@x.test', id, { at: later(50) })
    db.recordOpen('A@x.test ', id, { at: later(200) })
    db.recordClick('a@x.test', id, 'https://acme.example/pricing', { at: later(60) })
    db.recordClick('a@x.test', id, 'https://acme.example/pricing', { at: later(300) })
    // Images off: a click with no open still counts as opened.
    db.recordClick('b@x.test', id, 'https://acme.example/demo', { at: later(120) })
    db.recordClick('b@x.test', id, 'https://acme.example/pricing', { at: later(400) })
    db.updateRecipientBounceStatus('c@x.test', 'hard', String(id))
    // A bounced address can't open; a stray pixel load changes nothing.
    db.recordOpen('c@x.test', id, { at: later(50) })

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

  it("counts people's clicks, not security scanners'", async () => {
    const id = await sentCampaign(['h@x.test', 'i@x.test', 'j@x.test', 'k@x.test', 'l@x.test'])
    // Seconds after it was sent, every link at once: a scanner.
    db.recordClick('h@x.test', id, 'https://acme.example/pricing', { at: later(3) })
    db.recordClick('h@x.test', id, 'https://acme.example/demo', { at: later(3) })
    // Around when the hidden trap link was followed.
    db.recordTrap('i@x.test', id, later(30))
    db.recordClick('i@x.test', id, 'https://acme.example/pricing', { at: later(40) })
    // The request said it was a script.
    db.recordClick('j@x.test', id, 'https://acme.example/pricing', { at: later(600), automated: true })
    // Counted as a person's, until a click on another link a second later shows it was a scanner.
    db.recordClick('k@x.test', id, 'https://acme.example/pricing', { at: later(90) })
    expect((await emailService.getCampaignActivity(id)).recipients.find((r) => r.email === 'k@x.test')).toMatchObject({ outcome: 'clicked', clicks: 1 })
    db.recordClick('k@x.test', id, 'https://acme.example/demo', { at: later(91) })
    // A person, an hour later.
    db.recordClick('l@x.test', id, 'https://acme.example/pricing', { at: later(3600) })

    const { globalStats: s } = await emailService.getCampaignStats(id)
    expect(s).toMatchObject({ uniqueClicks: 1, totalClicks: 1, automatedClicks: 6, uniqueOpens: 1 })
    const { recipients, links } = await emailService.getCampaignActivity(id)
    for (const email of ['h@x.test', 'i@x.test', 'j@x.test', 'k@x.test']) {
      expect(recipients.find((r) => r.email === email)).toMatchObject({ outcome: 'sent', clicks: 0, clickedAt: null })
    }
    expect(recipients.find((r) => r.email === 'l@x.test')).toMatchObject({ outcome: 'clicked', clicks: 1, automatedClicks: 0 })
    expect(links).toEqual([{ url: 'https://acme.example/pricing', clicks: 1, people: 1 }])
  })

  it("counts people's opens, not security scanners' image loads", async () => {
    const id = await sentCampaign(['n@x.test', 'o@x.test', 'p@x.test', 'q@x.test'])
    // Loaded as the email arrived: a scanner.
    db.recordOpen('n@x.test', id, { at: later(2) })
    // Loaded around when the trap link was followed, even if the trap comes second.
    db.recordOpen('o@x.test', id, { at: later(45) })
    db.recordTrap('o@x.test', id, later(50))
    // The request said it was a script.
    db.recordOpen('p@x.test', id, { at: later(900), automated: true })
    // A person, later on, twice.
    db.recordOpen('q@x.test', id, { at: later(1800) })
    db.recordOpen('q@x.test', id, { at: later(3600) })

    const { globalStats: s } = await emailService.getCampaignStats(id)
    expect(s).toMatchObject({ uniqueOpens: 1, totalOpens: 2, automatedOpens: 3 })
    const { recipients } = await emailService.getCampaignActivity(id)
    for (const email of ['n@x.test', 'o@x.test', 'p@x.test']) {
      expect(recipients.find((r) => r.email === email)).toMatchObject({ outcome: 'sent', opens: 0, openedAt: null })
    }
    expect(recipients.find((r) => r.email === 'q@x.test')).toMatchObject({ outcome: 'opened', opens: 2, automatedOpens: 0 })
  })

  it('adds a hidden trap link to each email, which is not itself a tracked click', async () => {
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockClear()
    await sentCampaign(['m@x.test'])
    const html = vi.mocked(sendMail).mock.calls[0][0].html as string
    const traps = html.match(/<a href="https:\/\/example\.test\/api\/track\/click\?t=[^"]+" aria-hidden="true" tabindex="-1" style="display:none;mso-hide:all"><\/a>/g)
    expect(traps).toHaveLength(1)
    // Hidden by display alone, and not in the plain-text part.
    const { htmlToText } = await import('./providers/plainText')
    expect(htmlToText(html)).not.toContain('track/click?t=' + traps![0].match(/t=([^"]+)/)![1])
    // The visible link is tracked as usual.
    expect(html.match(/api\/track\/click/g)).toHaveLength(2)
  })

  it('keeps unsubscribes and spam complaints apart', async () => {
    const id = await sentCampaign(['e@x.test', 'f@x.test'])
    db.recordOpen('e@x.test', id, { at: later(50) })
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
    db.recordOpen('g@x.test', id, { at: later(50) })
    expect(db.data.campaign_recipients.find((r) => r.campaign_id === id)?.opens).toBe(2)
  })
})
