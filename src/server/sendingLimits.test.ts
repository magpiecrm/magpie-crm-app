import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Daily sending limits where the host's mail server sends, on a real (scratch)
// database: a campaign over today's limit carries on the next day, cold and
// opt-in email are limited apart, and the limit follows how the email is received.

const scratchDir = mkdtempSync(join(tmpdir(), 'sending-limits-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://example.test'
process.env.SENDING_MANAGED = 'on'

const sent: string[] = []
vi.mock('./nodemailer', () => ({ sendMail: vi.fn(async (msg: { to: string }) => (sent.push(msg.to), { messageId: 'x' })) }))
const notices: string[] = []
vi.mock('./notify', () => ({ notify: (_type: string, message: string) => notices.push(message) }))
// Sending domains are the host's to check; not what's tested here.
vi.mock('./sendingDomains', () => ({ canSendFrom: () => true, requireSendingDomain: () => {} }))

const { db } = await import('./db')
const emailService = await import('./emailService')
const { sendDueCampaigns } = await import('./emailScheduler')
const { dailyLimits, hasDailyRoom, RAMP } = await import('./sendingLimits')
const { judge, domainReputations } = await import('./sendingReputation')
const { refreshHostRules } = await import('./prospecting/hostRules')

const DAY = 86_400_000
const people = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}@acme.test`)

async function campaignFor(emails: string[], cold: string[] = []) {
  const list = await emailService.createList(`List ${Math.random()}`)
  await emailService.addContactsToList(list.id, emails.map((email) => ({ email, attributes: {} }) as any))
  // Found by prospecting, with a verified address: cold, and not held back as a guess.
  for (const email of cold) db.setContactProspectFields(email, { source: 'socialfetch', email_status: 'verified' })
  const { id } = await emailService.createCampaign({
    name: 'Launch', subject: 'Hello', htmlContent: '<p>Hi</p>',
    sender: { name: 'Acme', email: 'hi@acme.test' }, recipients: { listIds: [list.id] },
  })
  return id
}
/** A day passes: everything sent so far was sent `days` earlier. */
const daysPass = (days = 1) =>
  db.mutate((d) => {
    for (const r of d.campaign_recipients) if (r.sent_at) r.sent_at = new Date(Date.parse(r.sent_at) - days * DAY - 60_000).toISOString()
  })
const campaign = (id: number) => db.data.campaigns.find((c) => c.id === id)!

beforeEach(() => {
  sent.length = 0
  notices.length = 0
  process.env.SENDING_MANAGED = 'on'
  db.mutate((d) => {
    d.campaign_recipients = []
    d.sending_ramp = undefined
  })
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  delete process.env.SENDING_MANAGED
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('a campaign over the daily limit', () => {
  it("sends today's share, then carries on by itself each day until everyone has it", async () => {
    const emails = people('cold', 70)
    const id = await campaignFor(emails, emails)
    const res = await emailService.sendCampaign(id)
    expect(res).toMatchObject({ sentCount: 30, later: 40 })
    expect(sent).toHaveLength(30)
    expect(campaign(id)).toMatchObject({ status: 'scheduled', daily_pacing: { left: 40, sent: 30 } })
    expect(notices.at(-1)).toBe('"Launch" sent to 30 recipients today. The other 40 follow from tomorrow, as your daily sending limit allows.')

    // Not before its time, and not while today's limit is still used up.
    await sendDueCampaigns(new Date())
    expect(sent).toHaveLength(30)

    daysPass()
    await sendDueCampaigns(new Date(Date.parse(res.resumeAt!) + 60_000))
    expect(sent).toHaveLength(60)
    expect(campaign(id)).toMatchObject({ status: 'scheduled', daily_pacing: { left: 10, sent: 60 } })

    daysPass()
    await sendDueCampaigns(new Date(Date.parse(campaign(id).scheduled_at!) + 60_000))
    expect(new Set(sent).size).toBe(70)
    expect(campaign(id).status).toBe('sent')
    expect(campaign(id).daily_pacing ?? null).toBeNull()
  })

  it('keeps unverified addresses held back until the first of them show few bounces, a day at a time', async () => {
    const emails = people('guess', 60)
    const id = await campaignFor(emails)
    for (const email of emails) db.setContactProspectFields(email, { source: 'socialfetch', email_status: 'catch_all_likely' })
    // Day 1: 30 of the first batch of 50 fit the limit, and the hold is judged on those 30.
    await emailService.sendCampaign(id)
    expect(sent).toHaveLength(30)
    expect(db.getGuessHold(id)).toMatchObject({ status: 'waiting', first_batch: 30 })
    expect(campaign(id).status).toBe('scheduled')

    // Day 2: nobody else is sure enough to send to, so it's done bar the held ones, who are then let go.
    daysPass()
    await sendDueCampaigns(new Date(Date.parse(campaign(id).scheduled_at!) + 60_000))
    expect(notices.some((n) => n.startsWith('"Launch" finished sending to 30 recipients. 30 more with unverified addresses follow once the first 30 show how many bounce'))).toBe(true)
    expect(sent).toHaveLength(60)
    expect(campaign(id).status).toBe('sent')
    expect(db.getGuessHold(id)?.status).toBe('released')
  })

  it('limits cold and opt-in email apart', async () => {
    const cold = people('prospect', 40)
    const optedIn = people('signup', 40)
    const id = await campaignFor([...cold, ...optedIn], cold)
    const res = await emailService.sendCampaign(id)
    expect(res).toMatchObject({ sentCount: 70, later: 10 })
    expect(sent.filter((e) => e.startsWith('prospect'))).toHaveLength(30)
    expect(sent.filter((e) => e.startsWith('signup'))).toHaveLength(40)
    // Someone found by prospecting who has since signed up counts as opted in.
    db.mutate((d) => (d.contacts.find((c) => c.email === 'prospect39@acme.test')!.signed_up_at = new Date().toISOString()))
    expect(hasDailyRoom('prospect38@acme.test')).toBe(false)
    expect(hasDailyRoom('prospect39@acme.test')).toBe(true)
  })

  it("has no daily limit where the host's mail server isn't sending", async () => {
    delete process.env.SENDING_MANAGED
    const emails = people('self', 70)
    const id = await campaignFor(emails, emails)
    expect(await emailService.sendCampaign(id)).toMatchObject({ sentCount: 70, later: 0 })
    expect(dailyLimits()).toBeNull()
  })
})

describe('the limit follows how the email is received', () => {
  /** A week of cold sending: `n` emails four days ago, some opened or bounced. */
  function weekOf(n: number, over: { opened?: number; bounced?: number } = {}) {
    const at = new Date(Date.now() - 4 * DAY).toISOString()
    db.mutate((d) => {
      d.campaigns.push({ id: 900, name: 'Earlier', subject: 's', preview_text: null, html_content: '', list_id: null, sender_id: d.senders[0]?.id ?? null, status: 'sent', unsubscribe_enabled: true, created_at: at, sent_at: at } as any)
      for (let i = 0; i < n; i++) {
        const email = `week${i}@acme.test`
        if (!d.contacts.some((c) => c.email === email)) d.contacts.push({ email, first_name: '', last_name: '', job_title: '', company: '', status: 'subscribed', created_at: at, source: 'socialfetch' } as any)
        d.campaign_recipients.push({
          campaign_id: 900, contact_email: email, sent_at: at, clicked_at: null,
          status: i < (over.bounced ?? 0) ? 'bounced_hard' : 'sent',
          opened_at: i >= n - (over.opened ?? 0) ? at : null,
        })
      }
      d.sending_ramp = { cold: { level: 1, since: new Date(Date.now() - 8 * DAY).toISOString() } }
    })
  }

  it('starts cold email at the first step and opt-in where its weeks of sending put it', () => {
    weekOf(40, { opened: 12 })
    db.mutate((d) => (d.sending_ramp = undefined))
    const limits = dailyLimits()!
    expect(limits.cold).toMatchObject({ limit: RAMP.cold[0], nextLimit: RAMP.cold[1], setByHost: false })
    expect(limits.optIn.limit).toBe(RAMP.optIn[0])
  })

  it('steps up after a week received well', () => {
    weekOf(40, { opened: 12 })
    expect(dailyLimits()!.cold).toMatchObject({ limit: RAMP.cold[2], status: 'good' })
  })

  it("holds when the week's email was mostly unopened, and steps down when it bounced", () => {
    weekOf(40, { opened: 2 })
    expect(dailyLimits()!.cold).toMatchObject({ limit: RAMP.cold[1], status: 'at_risk' })
    db.mutate((d) => (d.campaign_recipients = []))
    weekOf(40, { opened: 12, bounced: 3 })
    expect(dailyLimits()!.cold).toMatchObject({ limit: RAMP.cold[0], status: 'poor' })
  })

  it("holds when too little was sent to judge, and uses the host's own limit when it sets one", async () => {
    weekOf(10, { opened: 5 })
    expect(dailyLimits()!.cold).toMatchObject({ limit: RAMP.cold[1], status: 'unknown' })

    Object.assign(process.env, { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rules: {}, sendLimits: { cold: 5 } })))
    try {
      await refreshHostRules()
      expect(dailyLimits()!.cold).toMatchObject({ limit: 5, setByHost: true, nextStepAt: null })
      expect(dailyLimits()!.optIn.setByHost).toBe(false)
    } finally {
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rules: {} })))
      await refreshHostRules()
      vi.unstubAllGlobals()
      for (const k of ['PROSPECTING_MANAGED', 'REACHER_URL', 'REACHER_SECRET']) delete process.env[k]
    }
  })
})

describe('reputation', () => {
  const stats = (over: Partial<Parameters<typeof judge>[0]> = {}) => ({
    sent: 200, hardBounces: 0, complaints: 0, unsubscribes: 0, replies: 0, tracked: 200, opened: 60,
    byHost: { google: { tracked: 100, opened: 30 }, microsoft: { tracked: 80, opened: 25 }, other: { tracked: 20, opened: 5 } },
    ...over,
  })

  it('is good when little bounces, nobody complains and people open it', () => {
    expect(judge(stats())).toMatchObject({ status: 'good', reasons: [] })
    expect(judge(stats({ sent: 12 })).status).toBe('unknown')
  })

  it('turns on bounces and spam complaints, and says what to do', () => {
    expect(judge(stats({ hardBounces: 5 })).reasons[0]).toMatchObject({ level: 'at_risk', code: 'bounces' })
    expect(judge(stats({ hardBounces: 12 })).status).toBe('poor')
    const complained = judge(stats({ complaints: 1 }))
    expect(complained).toMatchObject({ status: 'poor' })
    expect(complained.reasons[0].text).toBe('0.5% of recipients marked it as spam (1 of 200).')
    expect(complained.reasons[0].fix).toMatch(/unsubscribe link/)
  })

  it("names the mail provider whose recipients aren't opening it", () => {
    const r = judge(stats({ opened: 32, byHost: { google: { tracked: 100, opened: 4 }, microsoft: { tracked: 80, opened: 25 }, other: { tracked: 20, opened: 3 } } }))
    expect(r.status).toBe('at_risk')
    expect(r.reasons.map((x) => x.code)).toEqual(['opens_google'])
    expect(r.reasons[0].text).toBe("Only 4% of recipients at Google (Gmail) opened it (4 of 100), which usually means it's landing in spam there.")
  })

  it('comes with a score out of 100 that never disagrees with the status', () => {
    expect(judge(stats())).toMatchObject({ status: 'good', score: 100 })
    expect(judge(stats({ sent: 12 })).score).toBeNull()
    // Just short of a level is still good (80 or more); at it, under 80; at the poor level, under 50.
    const bounced = (n: number) => judge(stats({ sent: 1000, hardBounces: n }))
    expect(bounced(19)).toMatchObject({ status: 'good', score: 82 })
    expect(bounced(20)).toMatchObject({ status: 'at_risk', score: 79 })
    expect(bounced(49)).toMatchObject({ status: 'at_risk', score: 52 })
    expect(bounced(50)).toMatchObject({ status: 'poor', score: 49 })
    expect(bounced(150)).toMatchObject({ status: 'poor', score: 0 })
    // The weakest signal sets it: Gmail's 4% opens, whatever Outlook's are.
    const fewOpens = judge(stats({ opened: 32, byHost: { google: { tracked: 100, opened: 4 }, microsoft: { tracked: 80, opened: 25 }, other: { tracked: 20, opened: 3 } } }))
    expect(fewOpens).toMatchObject({ status: 'at_risk', score: 65 })
    // Opens and unsubscribes alone never make it poor.
    expect(judge(stats({ opened: 0, byHost: { google: { tracked: 100, opened: 0 }, microsoft: { tracked: 80, opened: 0 }, other: { tracked: 20, opened: 0 } } })).score).toBe(55)
    expect(judge(stats({ unsubscribes: 60 })).score).toBe(51)
  })

  it('is worked out for each sending domain from what was sent', async () => {
    const emails = people('rep', 30)
    const id = await campaignFor(emails, emails)
    await emailService.sendCampaign(id)
    db.mutate((d) => d.campaign_recipients.slice(0, 2).forEach((r) => (r.status = 'bounced_hard')))
    const [domain] = domainReputations()
    expect(domain).toMatchObject({ domain: 'acme.test', status: 'poor', stats: { sent: 30, hardBounces: 2 } })
  })
})
