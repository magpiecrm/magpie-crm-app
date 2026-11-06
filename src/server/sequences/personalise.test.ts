import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Personalised first emails: the checks a draft must pass, what the AI is
// given, and the engine end to end on a scratch database, holding a first
// email until it's written and sending it as written, with the AI replaced.

const scratchDir = mkdtempSync(join(tmpdir(), 'personalise-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://app.example.test'

type Sent = { to: string; subject: string; text?: string; inReplyTo?: string }
const sent: Sent[] = []
vi.mock('../nodemailer', () => ({
  sendMail: vi.fn(async (msg: Sent) => {
    sent.push(msg)
    return { messageId: 'provider-id' }
  }),
}))
const notices: string[] = []
vi.mock('../notify', () => ({ notify: (type: string, message: string) => notices.push(`${type}: ${message}`) }))
let ai: { ok: true; web: boolean } | { ok: false; reason: string } = { ok: true, web: true }
vi.mock('../copilot/availability', () => ({ aiAvailable: () => ai }))

const { db } = await import('../db')
const { sequences } = await import('.')
const { runSequences } = await import('./engine')
const { allowedLinks, checkDraft, draftPrompt, runDrafts, AI_RETRY_MS } = await import('./personalise')
const { AiFailed, AiUnavailable } = await import('../copilot/generate')
const { moveFirstEmailDrafts } = await import('../../features/sequences/types')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const always = { days: [0, 1, 2, 3, 4, 5, 6], start_hour: 0, end_hour: 24, time_zone: 'Europe/London' }
const DAY = 86_400_000
const BRIEF = 'We help accounting firms onboard clients faster. Ask for a short call. Pilot: https://acme.example/pilot'
const FACTS = [{ text: 'Larkspur makes onboarding software.', url: 'https://larkspur.test/' }]
const BODY = 'Hi Ava,\n\nI saw Larkspur makes onboarding software, so you know how slow client paperwork can be. We help accounting firms cut that down.\n\nWould a short call next week be useful?'

function contact(email: string, extra: Record<string, unknown> = {}) {
  db.mutate((d) => {
    d.contacts = d.contacts.filter((c) => c.email !== email)
    d.contacts.push({ email, first_name: 'Ava', last_name: 'Stone', job_title: 'Head of Operations', company: 'Larkspur', status: 'subscribed', created_at: new Date().toISOString(), ...extra } as any)
  })
}

function makeSequence(brief: string | null = BRIEF) {
  const s = sequences.create({ name: 'Intro', senderId: 1 }, 'me@acme.test')
  sequences.update(s.id, {
    steps: [
      { delay_days: 0, subject: 'Quick question, {{ contact.first_name }}', body: 'Hi {{ contact.first_name }},\n\nSee https://acme.example/pilot.', personalise: brief === null ? null : { brief } },
      { delay_days: 3, subject: null, body: 'Following up, {{ contact.first_name }}.' },
    ],
    settings: { ...always, daily_cap: 50, signature: 'Jo, Acme' },
  })
  sequences.setStatus(s.id, 'active')
  return s.id
}

const enrollmentOf = (sequenceId: string, email: string) => db.data.sequence_enrollments!.find((e) => e.sequence_id === sequenceId && e.contact_email === email)!
const research = vi.fn(async () => ({ facts: FACTS, web: true, at: '' }))
const writes = (...answers: Array<{ subject?: string; body: string; facts_used?: number[] } | Error>) => {
  const fn = vi.fn(async () => {
    const next = answers.shift()
    if (!next) throw new AiFailed('no more answers')
    if (next instanceof Error) throw next
    return { answer: { facts_used: [], ...next }, web: true, model: 'm' }
  })
  return fn as any
}

beforeEach(() => {
  sent.length = 0
  notices.length = 0
  ai = { ok: true, web: true }
  research.mockClear()
  db.mutate((d) => {
    d.sequences = []
    d.sequence_enrollments = []
    d.email_stops = {}
    if (!d.senders.some((s) => s.id === 1)) d.senders.push({ id: 1, name: 'Jo', email: 'jo@acme.test' })
  })
})

describe('checking a draft', () => {
  const allowed = allowedLinks({ subject: 'Hi', body: 'See https://acme.example/pilot.', personalise: { brief: BRIEF } })
  const ok = { subject: 'Onboarding at Larkspur', body: BODY }

  it('passes a plain email, and links that were in the brief or the example', () => {
    expect(checkDraft(ok, allowed)).toBeNull()
    expect(checkDraft({ ...ok, body: `${BODY}\n\nMore: https://acme.example/pilot/.` }, allowed)).toBeNull()
  })

  it('stops merge tags, placeholders, other links, an unsubscribe line and odd subjects', () => {
    expect(checkDraft({ ...ok, body: `${BODY} {{ contact.first_name }}` }, allowed)).toMatch(/merge tag/)
    expect(checkDraft({ ...ok, body: BODY.replace('Ava', '[First name]') }, allowed)).toMatch(/placeholder.*\[First name\]/)
    expect(checkDraft({ ...ok, body: `${BODY} https://evil.example/x` }, allowed)).toMatch(/links to https:\/\/evil\.example\/x/)
    expect(checkDraft({ ...ok, body: `${BODY} Unsubscribe any time.` }, allowed)).toMatch(/unsubscrib/)
    expect(checkDraft({ ...ok, subject: 'Two\nlines' }, allowed)).toMatch(/line break/)
    expect(checkDraft({ ...ok, body: 'Too short.' }, allowed)).toMatch(/too short/)
  })

  it('stops an email that tells them what their own company does, and passes one about what it means for them', () => {
    const tailored = `Hi Ava,\n\nTwo new offices means twice the client paperwork landing on operations. ${BODY.split('\n\n').slice(2).join('\n\n')}`
    expect(checkDraft({ ...ok, body: tailored }, allowed, 'Larkspur Ltd')).toBeNull()
    expect(checkDraft({ ...ok, body: `Hi Ava,\n\nLarkspur's two new offices mean twice the client paperwork. ${'We help with that. '.repeat(4)}` }, allowed, 'Larkspur')).toBeNull()
    for (const opener of [
      'Larkspur is an accounting firm for small businesses in Yorkshire.',
      "Larkspur's onboarding app handles client paperwork.",
      'Larkspur Ltd makes onboarding software.',
      'At Larkspur, you help small firms with their books.',
    ]) {
      expect(checkDraft({ ...ok, body: `Hi Ava,\n\n${opener} ${'We help with that. '.repeat(4)}` }, allowed, 'Larkspur Ltd')).toMatch(/what their own company does/)
    }
  })
})

describe('what the AI is given', () => {
  it("is the brief, the example filled in for them, their job and company and the company's facts, never their address", () => {
    const prompt = draftPrompt({
      step: { subject: 'Quick question, {{ contact.first_name }}', body: 'Hi {{ contact.first_name }}', personalise: { brief: BRIEF } },
      contact: { email: 'ava@larkspur.test', first_name: 'Ava', last_name: 'Stone', job_title: 'Head of Operations', company: 'Larkspur', country: 'United Kingdom' } as any,
      facts: FACTS,
      sender: { name: 'Jo' },
      brand: { name: 'Acme', toneOfVoice: 'Warm, plain' },
    })
    expect(prompt).toContain(BRIEF)
    expect(prompt).toContain('Subject: Quick question, Ava')
    expect(prompt).toContain('Job: Head of Operations')
    expect(prompt).toContain('1. Larkspur makes onboarding software. (https://larkspur.test/)')
    expect(prompt).toContain('Tone of voice: Warm, plain')
    expect(prompt).not.toContain('ava@larkspur.test')
    expect(prompt).not.toContain('Stone')
  })
})

describe('the engine with personalised emails', () => {
  it('holds each email until it is written and sends it as written: the first, then a follow-up in its thread', async () => {
    contact('ava@larkspur.test')
    const id = makeSequence()
    sequences.enroll(id, ['ava@larkspur.test'], {}, null)
    const steps = sequences.get(id).sequence.steps
    const draft = (i: number) => enrollmentOf(id, 'ava@larkspur.test').drafts?.[steps[i].id]
    expect(draft(0)).toMatchObject({ status: 'pending' })
    const t0 = new Date()
    expect(await runSequences(t0, () => 0.5)).toBe(0)

    const generate = writes({ subject: 'Onboarding at Larkspur', body: BODY, facts_used: [1, 5] })
    expect(await runDrafts(t0, { generate, research })).toBe(1)
    expect(research).toHaveBeenCalledWith({ name: 'Larkspur', domain: 'larkspur.test', country: null }, expect.anything())
    expect(draft(0)).toMatchObject({ status: 'ready', subject: 'Onboarding at Larkspur', facts: FACTS })

    expect(await runSequences(t0, () => 0.5)).toBe(1)
    expect(sent[0].subject).toBe('Onboarding at Larkspur')
    expect(sent[0].text).toMatch(/^Hi Ava,\n\nI saw Larkspur makes onboarding software[\s\S]*next week be useful\?\n\nJo, Acme\n\nNot interested\? Unsubscribe here \(https:\/\/app\.example\.test\/api\/unsubscribe\?t=/)
    // Kept as the record of what went out, and too late to change.
    expect(() => sequences.draft(enrollmentOf(id, 'ava@larkspur.test').id, steps[0].id, { rewrite: true })).toThrow(/already gone/)

    // The follow-up waits for its own, written from what they were sent.
    const t3 = new Date(t0.getTime() + 3 * DAY + 60_000)
    expect(await runSequences(t3, () => 0.5)).toBe(0)
    expect(draft(1)).toMatchObject({ status: 'pending' })
    const followUp = writes({ subject: 'Ignored: it replies in the thread', body: 'Ava, new clients usually arrive in batches after a launch, which is when onboarding backs up most. Want me to show you how firms handle that?' })
    expect(await runDrafts(t3, { generate: followUp, research })).toBe(1)
    const asked = followUp.mock.calls[0][0]
    expect(asked.answer.name).toBe('writeFollowUp')
    expect(asked.prompt).toContain("## What you've sent them so far (no reply yet)\n### First email\nSubject: Onboarding at Larkspur")
    expect(asked.prompt).toContain('I saw Larkspur makes onboarding software')
    expect(asked.prompt).toContain('It replies in the same conversation: no subject line.')
    expect(draft(1)).toMatchObject({ status: 'ready' })
    expect(draft(1)).not.toHaveProperty('subject')

    expect(await runSequences(t3, () => 0.5)).toBe(1)
    expect(sent[1]).toMatchObject({ subject: 'Re: Onboarding at Larkspur', inReplyTo: expect.any(String) })
    expect(sent[1].text).toMatch(/^Ava, new clients usually arrive in batches/)
  })

  it("sends the step's own email when the AI's can't pass the checks, or the AI keeps failing", async () => {
    contact('ava@larkspur.test')
    contact('bo@larkspur.test', { first_name: 'Bo' })
    const id = makeSequence()
    const first = sequences.get(id).sequence.steps[0].id
    sequences.enroll(id, ['ava@larkspur.test'], {}, null)
    const t0 = new Date()
    await runDrafts(t0, { generate: writes({ subject: 'Hi', body: `${BODY} {{ contact.first_name }}` }, { subject: 'Hi', body: `${BODY} [Calendar link]` }), research })
    expect(enrollmentOf(id, 'ava@larkspur.test').drafts?.[first]).toMatchObject({ status: 'fallback', reason: expect.stringMatching(/placeholder/) })
    await runSequences(t0, () => 0.5)
    expect(sent[0].subject).toBe('Quick question, Ava')

    sequences.enroll(id, ['bo@larkspur.test'], {}, null)
    const failing = writes(new AiFailed('busy'), new AiFailed('busy'), new AiFailed('busy'))
    for (let i = 0; i < 3; i++) await runDrafts(t0, { generate: failing, research })
    expect(enrollmentOf(id, 'bo@larkspur.test').drafts?.[first]).toMatchObject({ status: 'fallback', attempts: 3, reason: expect.stringMatching(/busy/) })
  })

  it('refuses a follow-up that only says it is checking in, and sends the standard one if it keeps doing so', async () => {
    contact('ava@larkspur.test')
    const id = makeSequence()
    sequences.enroll(id, ['ava@larkspur.test'], {}, null)
    const t0 = new Date()
    await runDrafts(t0, { generate: writes({ subject: 'Onboarding at Larkspur', body: BODY }), research })
    await runSequences(t0, () => 0.5)
    const t3 = new Date(t0.getTime() + 3 * DAY + 60_000)
    const nudges = writes({ body: 'Hi Ava, just checking in on my last note about onboarding. Any thoughts?' }, { body: 'Hi Ava, just following up on my email below in case it got buried.' })
    await runDrafts(t3, { generate: nudges, research })
    expect(nudges.mock.calls[1][0].prompt).toMatch(/following up or checking in/)
    const step = sequences.get(id).sequence.steps[1]
    expect(enrollmentOf(id, 'ava@larkspur.test').drafts?.[step.id]).toMatchObject({ status: 'fallback' })
    await runSequences(t3, () => 0.5)
    expect(sent[1].text).toMatch(/^Following up, Ava\./)
  })

  it("pauses instead of sending everyone the standard email when the AI can't be used, and carries on later", async () => {
    contact('ava@larkspur.test')
    const id = makeSequence()
    sequences.enroll(id, ['ava@larkspur.test'], {}, null)
    const t0 = new Date()
    await runDrafts(t0, { generate: writes(new AiUnavailable("You've used this month's AI budget.")), research })
    expect(sequences.get(id).sequence).toMatchObject({ status: 'paused', auto_paused: 'ai', paused_reason: expect.stringMatching(/AI budget/) })
    expect(notices).toHaveLength(1)
    expect(enrollmentOf(id, 'ava@larkspur.test').drafts?.[sequences.get(id).sequence.steps[0].id]).toMatchObject({ status: 'pending' })

    // Stays paused while the AI is out, and for an hour after it failed even once it's back; then carries on.
    const row = db.data.sequences!.find((x) => x.id === id)!
    ai = { ok: false, reason: 'No budget.' }
    row.updated_at = new Date(Date.now() - AI_RETRY_MS - 1).toISOString()
    await runSequences(new Date(), () => 0.5)
    expect(sequences.get(id).sequence.status).toBe('paused')
    ai = { ok: true, web: true }
    row.updated_at = new Date().toISOString()
    await runSequences(new Date(), () => 0.5)
    expect(sequences.get(id).sequence.status).toBe('paused')
    row.updated_at = new Date(Date.now() - AI_RETRY_MS - 1).toISOString()
    await runSequences(new Date(), () => 0.5)
    expect(sequences.get(id).sequence.status).toBe('active')
    expect(sent).toHaveLength(0)
  })

  it('writes unsent ones again when what they come from changes, keeping hand edits, and drops them when switched off', async () => {
    contact('ava@larkspur.test')
    contact('bo@larkspur.test', { first_name: 'Bo' })
    const id = makeSequence()
    sequences.enroll(id, ['ava@larkspur.test', 'bo@larkspur.test'], {}, null)
    await runDrafts(new Date(), { generate: writes({ subject: 'One', body: BODY }, { subject: 'Two', body: BODY }), research })
    const steps = sequences.get(id).sequence.steps
    const draft = (email: string, i = 0) => enrollmentOf(id, email).drafts?.[steps[i].id]
    const bo = enrollmentOf(id, 'bo@larkspur.test')
    sequences.draft(bo.id, steps[0].id, { subject: 'My own words', body: 'Hi Bo, written by hand.' })
    expect(draft('bo@larkspur.test')).toMatchObject({ status: 'ready', subject: 'My own words', edited: true })
    expect(() => sequences.draft(bo.id, steps[0].id, { subject: 'Hi', body: 'Hi {{ contact.nickname }}' })).toThrow(/isn't a contact field/)
    // A follow-up in the thread is edited without a subject.
    sequences.draft(bo.id, steps[1].id, { body: 'Bo, one more thing.' })
    expect(draft('bo@larkspur.test', 1)).toMatchObject({ status: 'ready', body: 'Bo, one more thing.', edited: true })
    expect(draft('bo@larkspur.test', 1)).not.toHaveProperty('subject')

    // Only the follow-up's text changes: only its unsent drafts are written again.
    sequences.update(id, { steps: [steps[0], { ...steps[1], body: 'A new nudge, {{ contact.first_name }}.' }] })
    expect(draft('ava@larkspur.test')).toMatchObject({ status: 'ready', subject: 'One' })
    sequences.update(id, { steps: [{ ...steps[0], personalise: { brief: `${BRIEF} Mention our free trial.` } }, { ...steps[1], body: 'A new nudge, {{ contact.first_name }}.' }] })
    expect(draft('ava@larkspur.test')).toMatchObject({ status: 'pending' })
    expect(draft('bo@larkspur.test')).toMatchObject({ subject: 'My own words' })

    // Left out of an edit (the copilot changing the wait), it stays on.
    sequences.update(id, { steps: [{ id: steps[0].id, delay_days: 1, subject: steps[0].subject, body: steps[0].body }, steps[1]] })
    expect(sequences.get(id).sequence.steps[0].personalise).toBeTruthy()
    sequences.update(id, { steps: [{ ...steps[0], personalise: null }, steps[1]] })
    expect(enrollmentOf(id, 'ava@larkspur.test').drafts).toEqual({})
    expect(enrollmentOf(id, 'bo@larkspur.test').drafts).toEqual({})
  })

  it("won't start a personalised sequence without the AI, and the switch is the first email's", () => {
    ai = { ok: false, reason: 'Add an Anthropic or OpenAI API key in Settings → Copilot.' }
    expect(() => makeSequence()).toThrow(/written for each person by the AI: Add an Anthropic/)
    ai = { ok: true, web: true }
    const s = sequences.create({ name: 'Two', senderId: 1 }, null)
    sequences.update(s.id, { steps: [{ delay_days: 0, subject: 'Hi', body: 'Hello' }, { delay_days: 2, subject: null, body: 'Again', personalise: { brief: 'x' } }] })
    expect(sequences.get(s.id).sequence.steps.map((st) => st.personalise ?? null)).toEqual([null, null])
  })

  it('moves an enrollment from before there was a draft for each email', () => {
    const seqs = [{ id: 's1', steps: [{ id: 'a' }, { id: 'b' }] }] as any
    const old = [{ id: 'e1', sequence_id: 's1', personal: { status: 'ready', subject: 'Hi', body: 'x', at: 'now', attempts: 0 } }] as any
    expect(moveFirstEmailDrafts(seqs, old)).toBe(1)
    expect(old[0]).toEqual({ id: 'e1', sequence_id: 's1', drafts: { a: { status: 'ready', subject: 'Hi', body: 'x', at: 'now', attempts: 0 } } })
  })
})
