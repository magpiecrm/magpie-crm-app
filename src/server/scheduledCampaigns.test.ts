import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scheduled campaigns end to end, on a real (scratch) database: they wait for
// their time, send once when the email scheduler finds them due, and never
// twice, even if someone presses Send at the same moment.

const scratchDir = mkdtempSync(join(tmpdir(), 'scheduled-campaigns-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://example.test'

const sent: string[] = []
vi.mock('./nodemailer', () => ({
  sendMail: vi.fn(async (msg: { to: string }) => {
    // A little latency, so a racing send gets its chance to interleave.
    await new Promise((r) => setTimeout(r, 5))
    sent.push(msg.to)
    return { messageId: 'x' }
  }),
}))
const notices: string[] = []
vi.mock('./notify', () => ({ notify: (_type: string, message: string) => notices.push(`${_type}: ${message}`) }))

const { db } = await import('./db')
const emailService = await import('./emailService')
const { sendDueCampaigns } = await import('./emailScheduler')

const HOUR = 60 * 60_000

async function campaignFor(emails: string[]) {
  const list = await emailService.createList(`List ${Math.random()}`)
  await emailService.addContactsToList(list.id, emails.map((email) => ({ email, attributes: {} }) as any))
  const { id } = await emailService.createCampaign({
    name: 'Launch',
    subject: 'Hello',
    htmlContent: '<p>Hi</p>',
    sender: { name: 'Acme', email: 'hi@acme.test' },
    recipients: { listIds: [list.id] },
  })
  return id
}

beforeEach(() => {
  sent.length = 0
  notices.length = 0
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('scheduled campaigns', () => {
  it('keep their time, wait for it, send once when due, and show when they went', async () => {
    const id = await campaignFor(['a@x.test', 'b@x.test'])
    const at = new Date(Date.now() + HOUR)
    await emailService.updateCampaign(id, { scheduledAt: at.toISOString() })

    const scheduled = await emailService.getCampaign(id)
    expect(scheduled).toMatchObject({ status: 'scheduled', scheduledAt: at.toISOString(), sentAt: null })
    expect((await emailService.getCampaigns()).campaigns.find((c) => c.id === id)?.scheduledAt).toBe(at.toISOString())

    await sendDueCampaigns(new Date(at.getTime() - 60_000))
    expect(sent).toEqual([])

    await sendDueCampaigns(new Date(at.getTime() + 30_000))
    expect(sent.sort()).toEqual(['a@x.test', 'b@x.test'])
    const done = await emailService.getCampaign(id)
    expect(done.status).toBe('sent')
    // The real send time, not when it was created or scheduled.
    expect(Date.now() - new Date(done.sentAt!).getTime()).toBeLessThan(10_000)

    // Due again a minute later: nothing more goes out.
    await sendDueCampaigns(new Date(at.getTime() + 90_000))
    expect(sent).toHaveLength(2)
  })

  it('refuses a time in the past, and can be taken off the schedule', async () => {
    const id = await campaignFor(['c@x.test'])
    await expect(emailService.updateCampaign(id, { scheduledAt: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow(/future/)
    await emailService.updateCampaign(id, { scheduledAt: new Date(Date.now() + HOUR).toISOString() })
    await emailService.unscheduleCampaign(id)
    expect((await emailService.getCampaign(id)).status).toBe('draft')
    await sendDueCampaigns(new Date(Date.now() + 2 * HOUR))
    expect(sent).toEqual([])
  })

  it('sends once when Send is pressed just as it falls due', async () => {
    const id = await campaignFor(['d@x.test', 'e@x.test', 'f@x.test'])
    const at = new Date(Date.now() + HOUR)
    await emailService.updateCampaign(id, { scheduledAt: at.toISOString() })

    const manual = emailService.sendCampaign(id).catch((err: Error) => err.message)
    const scheduled = sendDueCampaigns(new Date(at.getTime() + 1000))
    const [manualResult] = await Promise.all([manual, scheduled])

    expect(sent.sort()).toEqual(['d@x.test', 'e@x.test', 'f@x.test'])
    expect(typeof manualResult === 'string' ? manualResult : 'sent').toMatch(/sent|already being sent/)
    expect((await emailService.getCampaign(id)).status).toBe('sent')
    expect(notices.filter((n) => n.startsWith('campaign_failed'))).toEqual([])
  })

  it("goes back to a draft and says why when it can't send at its time", async () => {
    const list = await emailService.createList('Empty')
    const { id } = await emailService.createCampaign({
      name: 'Nobody',
      subject: 'Hello',
      htmlContent: '<p>Hi</p>',
      sender: { name: 'Acme', email: 'hi@acme.test' },
      recipients: { listIds: [list.id] },
    })
    const at = new Date(Date.now() + HOUR)
    await emailService.updateCampaign(id, { scheduledAt: at.toISOString() })
    await sendDueCampaigns(new Date(at.getTime() + 1000))
    expect((await emailService.getCampaign(id)).status).toBe('draft')
    expect(notices).toEqual([expect.stringMatching(/^campaign_failed: "Nobody" didn't send at its scheduled time: .*list is empty/)])
    // Not retried every minute.
    await sendDueCampaigns(new Date(at.getTime() + 61_000))
    expect(notices).toHaveLength(1)
  })

  it('finishes a send cut off by a restart without repeating anyone', async () => {
    const id = await campaignFor(['g@x.test', 'h@x.test'])
    // As if the server stopped after reaching g@: it's still 'sending'.
    db.claimCampaignForSending(id)
    db.run(`INSERT OR REPLACE INTO campaign_recipients (campaign_id, contact_email, status) VALUES (?, ?, 'sent')`, [id, 'g@x.test'])
    await emailService.sendCampaign(id, { resume: true })
    expect(sent).toEqual(['h@x.test'])
    expect((await emailService.getCampaign(id)).status).toBe('sent')
  })
})

describe('new rows', () => {
  it('come back with their own id, even with more lists than campaigns', async () => {
    for (let i = 0; i < 4; i++) await emailService.createList(`Extra ${i}`)
    const { id } = await emailService.createCampaign({ name: 'Mine', subject: 'Hi', htmlContent: '<p>Hi</p>' })
    expect((await emailService.getCampaign(id)).name).toBe('Mine')
    const list = await emailService.createList('Latest')
    expect(db.data.lists.find((l) => l.id === list.id)?.name).toBe('Latest')
  })
})


describe('unverified addresses held back after a first batch', () => {
  async function guessedCampaign(prefix: string) {
    const emails = Array.from({ length: 60 }, (_, i) => `${prefix}${i}@acme.test`)
    const id = await campaignFor(emails)
    for (const email of emails) db.setContactProspectFields(email, { source: 'socialfetch', email_status: 'catch_all_likely' })
    await emailService.sendCampaign(id)
    expect(sent).toHaveLength(50)
    return { id, emails }
  }

  it('go out an hour later when the first batch barely bounced', async () => {
    const { id, emails } = await guessedCampaign('ok')
    db.updateRecipientBounceStatus(emails[0], 'hard', String(id))
    const sentAt = (await emailService.getCampaign(id)).sentAt

    await sendDueCampaigns(new Date(Date.now() + 30 * 60_000))
    expect(sent).toHaveLength(50)
    await sendDueCampaigns(new Date(Date.now() + HOUR + 60_000))
    expect(sent.slice(50).sort()).toEqual(emails.slice(50).sort())
    const done = await emailService.getCampaign(id)
    expect(done).toMatchObject({ status: 'sent', sentAt })
    expect(db.getGuessHold(id)).toMatchObject({ status: 'released', hard_bounces: 1 })
  })

  it('stay held, and the user is told, when too many of the first batch bounced', async () => {
    const { id, emails } = await guessedCampaign('bad')
    db.updateRecipientBounceStatus(emails[0], 'hard', String(id))
    db.updateRecipientBounceStatus(emails[1], 'hard', String(id))

    await sendDueCampaigns(new Date(Date.now() + HOUR + 60_000))
    expect(sent).toHaveLength(50)
    expect(db.getGuessHold(id)).toMatchObject({ status: 'stopped', hard_bounces: 2, held: 10 })
    expect(notices.at(-1)).toMatch(/2 of the first 50 unverified addresses bounced, so the other 10 weren't sent/)
    // Looked at once: a later minute doesn't send them either.
    await sendDueCampaigns(new Date(Date.now() + 2 * HOUR))
    expect(sent).toHaveLength(50)
  })
})

describe('held-back addresses in a hosted copy', () => {
  const KEYS = ['SENDING_MANAGED', 'PROSPECTING_MANAGED', 'REACHER_URL', 'REACHER_SECRET'] as const
  const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  afterAll(() => {
    for (const k of KEYS) (original[k] === undefined ? delete process.env[k] : (process.env[k] = original[k]))
    vi.unstubAllGlobals()
  })
  // Well up its daily sending limits (sendingLimits.ts), so these are about the hold alone.
  beforeAll(() => db.mutate((d) => (d.sending_ramp = { cold: { level: 5, since: new Date().toISOString() }, optIn: { level: 5, since: new Date().toISOString() } })))

  it("wait until the host has passed on every bounce, however long the wait was set to", async () => {
    const emails = Array.from({ length: 60 }, (_, i) => `hosted${i}@acme.test`)
    const id = await campaignFor(emails)
    for (const email of emails) db.setContactProspectFields(email, { source: 'socialfetch', email_status: 'catch_all_likely' })
    await emailService.sendCampaign(id)
    expect(sent).toHaveLength(50)

    Object.assign(process.env, { SENDING_MANAGED: 'on', PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })
    let eventsPending = true
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rules: {}, formatSharing: false, eventsPending })))

    await sendDueCampaigns(new Date(Date.now() + HOUR + 60_000))
    expect(sent).toHaveLength(50)
    expect(db.getGuessHold(id)?.status).toBe('waiting')

    eventsPending = false
    await sendDueCampaigns(new Date(Date.now() + HOUR + 120_000))
    expect(sent).toHaveLength(60)
    expect(db.getGuessHold(id)?.status).toBe('released')
  })

  it("don't wait forever on a host that never answers", async () => {
    const emails = Array.from({ length: 60 }, (_, i) => `silent${i}@acme.test`)
    delete process.env.SENDING_MANAGED
    const id = await campaignFor(emails)
    for (const email of emails) db.setContactProspectFields(email, { source: 'socialfetch', email_status: 'catch_all_likely' })
    await emailService.sendCampaign(id)
    process.env.SENDING_MANAGED = 'on'
    vi.stubGlobal('fetch', async () => new Response('down', { status: 502 }))

    await sendDueCampaigns(new Date(Date.now() + 3 * HOUR))
    expect(db.getGuessHold(id)?.status).toBe('waiting')
    await sendDueCampaigns(new Date(Date.now() + 26 * HOUR))
    expect(db.getGuessHold(id)?.status).toBe('released')
  })
})
