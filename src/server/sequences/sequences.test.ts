import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Sequences: the schedule maths, the email itself, and the engine end to end
// on a real (scratch) database, with sending and notifications replaced.

const scratchDir = mkdtempSync(join(tmpdir(), 'sequences-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://app.example.test'

type Sent = { to: string; subject: string; text?: string; html: string; messageId?: string; inReplyTo?: string; references?: string[]; campaignId?: number; unsubscribeUrl?: string }
const sent: Sent[] = []
let failNext: Error | null = null
vi.mock('../nodemailer', () => ({
  sendMail: vi.fn(async (msg: Sent) => {
    if (failNext) {
      const err = failNext
      failNext = null
      throw err
    }
    sent.push(msg)
    return { messageId: 'provider-id' }
  }),
}))
const notices: string[] = []
vi.mock('../notify', () => ({ notify: (type: string, message: string) => notices.push(`${type}: ${message}`) }))
let rules = { firstBatch: 50, holdHours: 1, maxBounceRate: 0.02 }
vi.mock('../prospecting/hostRules', async (original) => ({
  ...(await original<typeof import('../prospecting/hostRules')>()),
  prospectingRules: () => rules,
}))

const { db } = await import('../db')
const { sequences } = await import('.')
const { runSequences, recoverClaims } = await import('./engine')
const { firstSendable, inSendWindow, nextGapMs, remapStep, threadFor, zonedParts } = await import('./schedule')
const { renderStep } = await import('./render')
const emailService = await import('../emailService')
const { AllowanceError } = await import('../allowance')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const always = { days: [0, 1, 2, 3, 4, 5, 6], start_hour: 0, end_hour: 24, time_zone: 'Europe/London' }
const MIN = 60_000
const DAY = 86_400_000

function contact(email: string, extra: Record<string, unknown> = {}) {
  db.mutate((d) => {
    d.contacts = d.contacts.filter((c) => c.email !== email)
    d.contacts.push({ email, first_name: email.split('@')[0], last_name: 'Stone', job_title: '', company: 'Larkspur', status: 'subscribed', created_at: new Date().toISOString(), ...extra } as any)
  })
}

function makeSequence(opts: { cap?: number; steps?: Array<{ delay_days: number; subject: string | null; body: string }> } = {}) {
  const s = sequences.create({ name: 'Intro', senderId: 1 }, 'me@acme.test')
  sequences.update(s.id, {
    steps: opts.steps ?? [
      { delay_days: 0, subject: 'Quick question, {{ contact.first_name }}', body: 'Hi {{ contact.first_name }},\n\nSee https://acme.example/pilot.' },
      { delay_days: 3, subject: null, body: 'Following up, {{ contact.first_name }}.' },
    ],
    settings: { ...always, daily_cap: opts.cap ?? 50, signature: 'Jo, Acme' },
  })
  sequences.setStatus(s.id, 'active')
  return s.id
}

const enrollmentOf = (sequenceId: string, email: string) => db.data.sequence_enrollments!.find((e) => e.sequence_id === sequenceId && e.contact_email === email)!

beforeEach(() => {
  sent.length = 0
  notices.length = 0
  failNext = null
  rules = { firstBatch: 50, holdHours: 1, maxBounceRate: 0.02 }
  db.mutate((d) => {
    d.sequences = []
    d.sequence_enrollments = []
    d.email_stops = {}
    if (!d.senders.some((s) => s.id === 1)) d.senders.push({ id: 1, name: 'Jo', email: 'jo@acme.test' })
  })
})

describe('schedule', () => {
  it('reads local time across the clocks changing, and keeps to the sending days and hours', () => {
    // 25 Oct 2026: London goes back from BST (UTC+1) to GMT.
    expect(zonedParts(new Date('2026-10-24T08:30:00Z'), 'Europe/London')).toMatchObject({ hour: 9, minute: 30, weekday: 6, day: '2026-10-24' })
    expect(zonedParts(new Date('2026-10-26T08:30:00Z'), 'Europe/London')).toMatchObject({ hour: 8, weekday: 1 })
    const weekdays = { days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 17, time_zone: 'Europe/London' }
    expect(inSendWindow(new Date('2026-10-26T09:00:00Z'), weekdays)).toBe(true) // Monday 09:00 GMT
    expect(inSendWindow(new Date('2026-10-26T17:00:00Z'), weekdays)).toBe(false)
    expect(inSendWindow(new Date('2026-10-24T10:00:00Z'), weekdays)).toBe(false) // Saturday
    expect(inSendWindow(new Date('2026-10-26T14:00:00Z'), { ...weekdays, time_zone: 'America/New_York' })).toBe(true) // 10:00 there
  })

  it('says when an email due outside the window can go: the next sending day, at the start of the hours', () => {
    const weekdays = { days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 17, time_zone: 'Europe/London' }
    // Due Sunday 4 Oct 14:02 (BST): goes Monday 5 Oct 09:00 BST.
    expect(firstSendable(new Date('2026-10-04T13:02:00Z'), weekdays)?.toISOString()).toBe('2026-10-05T08:00:00.000Z')
    const inside = new Date('2026-10-05T10:07:00Z')
    expect(firstSendable(inside, weekdays)).toBe(inside)
    expect(firstSendable(inside, { ...weekdays, days: [] })).toBeNull()
  })

  it('spreads emails through what is left of the day, between a minute and twenty', () => {
    expect(nextGapMs(480, 48, () => 0.5)).toBe(10 * MIN)
    expect(nextGapMs(480, 1000, () => 0)).toBe(MIN)
    expect(nextGapMs(480, 2, () => 1)).toBe(20 * MIN)
  })

  it('threads follow-ups as replies, and starts again on a step with its own subject', () => {
    const steps = [{ id: 'a', subject: 'Hello' }, { id: 'b', subject: null }, { id: 'c', subject: 'New idea' }, { id: 'd', subject: null }]
    const sends = [{ step_id: 'a', message_id: '<1@x>', subject: 'Hello' }]
    expect(threadFor(steps[1], sends, steps)).toEqual({ subject: 'Re: Hello', inReplyTo: '<1@x>', references: ['<1@x>'] })
    const more = [...sends, { step_id: 'b', message_id: '<2@x>', subject: 'Re: Hello' }]
    expect(threadFor(steps[1], more, steps)).toEqual({ subject: 'Re: Hello', inReplyTo: '<2@x>', references: ['<1@x>', '<2@x>'] })
    expect(threadFor(steps[2], more, steps)).toEqual({ subject: 'New idea' })
    const fresh = [...more, { step_id: 'c', message_id: '<3@x>', subject: 'New idea' }]
    expect(threadFor(steps[3], fresh, steps)).toEqual({ subject: 'Re: New idea', inReplyTo: '<3@x>', references: ['<3@x>'] })
  })

  it('keeps people on the same email when steps change, moving on past a deleted one', () => {
    const old = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(remapStep(1, old, [{ id: 'x' }, { id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(2)
    expect(remapStep(1, old, [{ id: 'a' }, { id: 'c' }])).toBe(1)
    expect(remapStep(2, old, [{ id: 'a' }, { id: 'b' }])).toBe(2)
  })
})

describe('the email', () => {
  const base = { subject: 'Hi {{ contact.first_name }}', body: 'Hello <b>{{ contact.first_name }}</b>, see https://acme.example/a?b=1.', contact: { email: 'ava@x.test', first_name: 'Ava' } }
  const settings = { signature: 'Jo', footer: 'Unsubscribe: {{ unsubscribe }}', track_opens: false, track_clicks: false }

  it('is plain text with the sign-off and unsubscribe link, and the same words as escaped HTML', () => {
    const r = renderStep({ ...base, settings, unsubscribeUrl: 'https://app/u?t=1' }, { openUrl: 'https://app/o', clickUrl: (u) => `https://app/c?u=${u}` })
    expect(r.subject).toBe('Hi Ava')
    expect(r.text).toBe('Hello <b>Ava</b>, see https://acme.example/a?b=1.\n\nJo\n\nUnsubscribe: https://app/u?t=1')
    expect(r.html).toContain('Hello &lt;b&gt;Ava&lt;/b&gt;, see <a href="https://acme.example/a?b=1">https://acme.example/a?b=1</a>.<br>')
    expect(r.html).toContain('Unsubscribe: <a href="https://app/u?t=1">https://app/u?t=1</a>')
    expect(r.html).not.toContain('https://app/o')
    expect(r.html).not.toContain('https://app/c')
  })

  it('tracks opens and clicks only when the sequence does, and never in the text or the unsubscribe link', () => {
    const r = renderStep({ ...base, settings: { ...settings, track_opens: true, track_clicks: true }, unsubscribeUrl: 'https://app/u?t=1' }, { openUrl: 'https://app/o', clickUrl: (u) => `https://app/c?u=${u}` })
    expect(r.html).toContain('<a href="https://app/c?u=https://acme.example/a?b=1">')
    expect(r.html).toContain('<img src="https://app/o"')
    expect(r.html).toContain('<a href="https://app/u?t=1">')
    expect(r.text).toContain('https://acme.example/a?b=1')
    expect(r.text).not.toContain('app/c')
  })
})

describe('the engine', () => {
  it('sends the first email, then the follow-up as a reply in the same thread once it is due', async () => {
    contact('ava@larkspur.test')
    const id = makeSequence()
    expect(sequences.enroll(id, ['ava@larkspur.test'], {}, null)).toEqual({ enrolled: 1, skipped: {} })
    const t0 = new Date()
    expect(await runSequences(t0, () => 0.5)).toBe(1)
    expect(sent[0]).toMatchObject({ to: 'ava@larkspur.test', subject: 'Quick question, ava' })
    expect(sent[0].text).toMatch(/^Hi ava,\n\nSee https:\/\/acme\.example\/pilot\.\n\nJo, Acme\n\nNot interested\? Unsubscribe here .*: https:\/\/app\.example\.test\/api\/unsubscribe\?t=/)
    expect(sent[0].messageId).toMatch(/^<[\w-]+@acme\.test>$/)
    expect(sent[0].inReplyTo).toBeUndefined()

    // Not again before the follow-up's three days.
    expect(await runSequences(new Date(t0.getTime() + DAY), () => 0.5)).toBe(0)
    expect(await runSequences(new Date(t0.getTime() + 3 * DAY + MIN), () => 0.5)).toBe(1)
    expect(sent[1]).toMatchObject({ subject: 'Re: Quick question, ava', inReplyTo: sent[0].messageId, references: [sent[0].messageId] })
    expect(enrollmentOf(id, 'ava@larkspur.test')).toMatchObject({ status: 'finished', next_send_at: null })
    expect(await runSequences(new Date(t0.getTime() + 10 * DAY), () => 0.5)).toBe(0)

    // Each email is recorded under its step's hidden campaign row, which is no campaign.
    const steps = db.data.sequences![0].steps
    expect(sent.map((m) => m.campaignId)).toEqual([steps[0].campaign_id, steps[1].campaign_id])
    expect(db.data.campaign_recipients.filter((r) => r.contact_email === 'ava@larkspur.test').map((r) => r.status)).toEqual(['sent', 'sent'])
    expect((await emailService.getCampaigns()).campaigns.some((c: any) => c.id === steps[0].campaign_id)).toBe(false)
    await expect(emailService.getCampaign(steps[0].campaign_id!)).rejects.toThrow('Campaign not found')
    await expect(emailService.deleteCampaign(steps[0].campaign_id!)).rejects.toThrow('Campaign not found')
  })

  it('paces emails through the day and keeps to the daily cap', async () => {
    for (const n of [1, 2, 3]) contact(`p${n}@larkspur.test`)
    const id = makeSequence({ cap: 2 })
    sequences.enroll(id, ['p1@larkspur.test', 'p2@larkspur.test', 'p3@larkspur.test'], {}, null)
    // A Wednesday mid-morning still to come whenever the tests run: enrolling makes people due from now.
    const t0 = new Date()
    t0.setUTCDate(t0.getUTCDate() + ((3 - t0.getUTCDay() + 7) % 7 || 7))
    t0.setUTCHours(10, 0, 0, 0)
    expect(await runSequences(t0, () => 0)).toBe(1)
    // The next slot is at least a minute away.
    expect(await runSequences(new Date(t0.getTime() + 30_000), () => 0)).toBe(0)
    expect(await runSequences(new Date(t0.getTime() + 20 * MIN), () => 0)).toBe(1)
    // Two today: the cap.
    expect(await runSequences(new Date(t0.getTime() + 60 * MIN), () => 0)).toBe(0)
    // Tomorrow (a new day in London), the third.
    expect(await runSequences(new Date(t0.getTime() + DAY), () => 0)).toBe(1)
    expect(new Set(sent.map((m) => m.to)).size).toBe(3)
  })

  it('skips people who unsubscribed or bounced, and stops on a reply', async () => {
    for (const n of ['ann', 'bob', 'cat']) contact(`${n}@larkspur.test`)
    const id = makeSequence()
    sequences.enroll(id, ['ann@larkspur.test', 'bob@larkspur.test', 'cat@larkspur.test'], {}, null)
    db.stopEmail('ann@larkspur.test', 'unsubscribed')
    expect(enrollmentOf(id, 'ann@larkspur.test')).toMatchObject({ status: 'unsubscribed', stop_reason: 'Unsubscribed' })
    db.mutate((d) => (d.contacts.find((c) => c.email === 'bob@larkspur.test')!.status = 'bounced'))
    let t = Date.now()
    for (let i = 0; i < 4; i++) await runSequences(new Date((t += 21 * MIN)), () => 1)
    expect(sent.map((m) => m.to)).toEqual(['cat@larkspur.test'])
    expect(enrollmentOf(id, 'bob@larkspur.test')).toMatchObject({ status: 'bounced' })

    const cat = enrollmentOf(id, 'cat@larkspur.test')
    sequences.act([cat.id], 'mark_replied')
    expect(enrollmentOf(id, 'cat@larkspur.test')).toMatchObject({ status: 'replied', reply: { matched_by: 'manual' } })
    expect(db.data.campaign_recipients.find((r) => r.contact_email === 'cat@larkspur.test')?.replied_at).toBeTruthy()
    expect(await runSequences(new Date(t + 4 * DAY), () => 1)).toBe(0)
  })

  it("won't enroll people who can't be emailed, or twice, and says why", () => {
    contact('ok@larkspur.test')
    contact('gone@larkspur.test', { status: 'unsubscribed' })
    const id = makeSequence()
    expect(sequences.enroll(id, ['ok@larkspur.test', 'gone@larkspur.test', 'nobody@x.test'], { dryRun: true }, null)).toEqual({
      enrolled: 1,
      skipped: { unsubscribed: 1, not_contact: 1 },
    })
    expect(db.data.sequence_enrollments).toHaveLength(0)
    sequences.enroll(id, ['ok@larkspur.test'], {}, null)
    expect(sequences.enroll(id, ['OK@larkspur.test'], {}, null)).toEqual({ enrolled: 0, skipped: { already_in: 1 } })
  })

  it('pauses when the plan runs out of emails, and starts again by itself', async () => {
    contact('ava@larkspur.test')
    const id = makeSequence()
    sequences.enroll(id, ['ava@larkspur.test'], {}, null)
    failNext = new AllowanceError('emailsSent', 'none left', null)
    expect(await runSequences(new Date(), () => 1)).toBe(0)
    expect(sequences.get(id).sequence).toMatchObject({ status: 'paused', auto_paused: 'allowance' })
    expect(notices[0]).toMatch(/^sequence_paused: "Intro" paused: Your plan has no emails left/)
    expect(enrollmentOf(id, 'ava@larkspur.test').claim).toBeNull()
    // No allowance set here, so emails are available again: it resumes and sends.
    expect(await runSequences(new Date(Date.now() + MIN), () => 1)).toBe(1)
  })

  it('never sends an email twice after a restart mid-send', async () => {
    contact('ava@larkspur.test')
    const id = makeSequence()
    sequences.enroll(id, ['ava@larkspur.test'], {}, null)
    await runSequences(new Date(), () => 1)
    // The follow-up was claimed when the server stopped.
    const e = enrollmentOf(id, 'ava@larkspur.test')
    const step = db.data.sequences![0].steps[1]
    db.mutate((d) => {
      d.sequences![0].steps[1].campaign_id = d.sequences![0].steps[0].campaign_id
      e.claim = { step_id: step.id, message_id: '<claimed@acme.test>', at: new Date().toISOString() }
    })
    recoverClaims()
    expect(enrollmentOf(id, 'ava@larkspur.test')).toMatchObject({ status: 'finished', claim: null })
    expect(enrollmentOf(id, 'ava@larkspur.test').sends.at(-1)).toMatchObject({ message_id: '<claimed@acme.test>', uncertain: true })
    expect(await runSequences(new Date(Date.now() + 5 * DAY), () => 1)).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('holds unconfirmed addresses after a first batch until their bounces are in', async () => {
    rules = { firstBatch: 1, holdHours: 1, maxBounceRate: 0.02 }
    contact('g1@larkspur.test', { source: 'socialfetch', email_status: 'catch_all_likely' })
    contact('g2@larkspur.test', { source: 'socialfetch', email_status: 'catch_all_likely' })
    contact('sure@larkspur.test')
    const id = makeSequence()
    sequences.enroll(id, ['g1@larkspur.test', 'g2@larkspur.test', 'sure@larkspur.test'], {}, null)
    let t = Date.now()
    for (let i = 0; i < 4; i++) await runSequences(new Date((t += 21 * MIN)), () => 1)
    // One guess and the confirmed address; the second guess waits.
    expect(sent.map((m) => m.to).sort()).toEqual(['g1@larkspur.test', 'sure@larkspur.test'])
    expect(sequences.get(id).sequence.guess_gate).toMatchObject({ status: 'waiting', first_batch: 1 })
    // The first guess bounced: the rest are never emailed.
    db.updateRecipientBounceStatus('g1@larkspur.test', 'hard', String(db.data.sequences![0].steps[0].campaign_id))
    await runSequences(new Date(t + 2 * 60 * MIN), () => 1)
    expect(sequences.get(id).sequence.guess_gate).toMatchObject({ status: 'stopped', hard_bounces: 1 })
    expect(sent.map((m) => m.to)).not.toContain('g2@larkspur.test')
    expect(notices.some((n) => n.includes('unconfirmed addresses bounced'))).toBe(true)
  })

  it("won't start until it's ready", () => {
    const s = sequences.create({ name: 'Draft', senderId: 1 }, null)
    expect(() => sequences.setStatus(s.id, 'active')).toThrow('The first email needs a subject.')
    sequences.update(s.id, { steps: [{ delay_days: 0, subject: 'Hi', body: 'Hello' }], settings: { footer: 'Bye' } })
    expect(() => sequences.setStatus(s.id, 'active')).toThrow(/unsubscribe/)
  })
})
