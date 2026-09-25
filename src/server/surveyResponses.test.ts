import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SurveyDesign } from '../features/survey-builder/types'
import { DEFAULT_SURVEY_SETTINGS, DEFAULT_SURVEY_THEME } from '../features/survey-builder/types'

// db.ts reads DATABASE_PATH at import time, so point it at a scratch file first.
const scratchDir = mkdtempSync(join(tmpdir(), 'survey-responses-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

vi.mock('./notify', () => ({ notify: vi.fn() }))

const { db } = await import('./db')
const { submitSurveyPage, loadPublicSurvey } = await import('./surveyResponses')
const { encodeSurveyToken, decodeSurveyToken, expandSurveyPlaceholders, referencedSurveyIds } = await import('./surveyLinks')
const { createRateLimiter } = await import('./rateLimit')
const { issueEmbedToken } = await import('./surveyEmbed')
const { updateSurvey } = await import('./surveys')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const design: SurveyDesign = {
  theme: DEFAULT_SURVEY_THEME,
  pages: [
    {
      id: 'p1',
      blocks: [
        { id: 'nps', type: 'nps', question: { title: 'NPS', required: true, mapTo: { field: 'custom:nps', overwrite: 'always' } } },
      ],
      rules: [{ id: 'r', when: { questionId: 'nps', op: 'lte', value: 6 }, goTo: { kind: 'page', pageId: 'p2' } }],
      defaultNext: { kind: 'page', pageId: 'p3' },
    },
    { id: 'p2', blocks: [{ id: 'why', type: 'long_text', question: { title: 'Why', required: true } }], defaultNext: { kind: 'end' } },
    {
      id: 'p3',
      blocks: [
        { id: 'email', type: 'email', question: { title: 'Email', required: false } },
        { id: 'co', type: 'short_text', question: { title: 'Company', required: false, mapTo: { field: 'company', overwrite: 'if_empty' } } },
      ],
    },
  ],
}

let surveyId: string
beforeEach(() => {
  db.data.survey_responses = []
  db.data.contact_fields = []
  db.addContactField({ key: 'nps', label: 'NPS', type: 'number' })
  db.upsertContact('known@example.com', { builtin: { company: 'Acme' } }, { create: true })
  delete db.getContact('known@example.com')!.custom
  const survey = db.addSurvey({ name: 'Test', design, settings: { ...DEFAULT_SURVEY_SETTINGS, listId: null } })
  db.updateSurvey(survey.id, { status: 'published' })
  surveyId = survey.id
})

const token = (extra: Partial<{ c: number | null; test: boolean; s: string }> = {}) =>
  encodeSurveyToken({ e: 'known@example.com', c: null, s: surveyId, ...extra })

describe('surveyLinks', () => {
  it('round-trips tokens and rejects ones for another survey', () => {
    const t = token({ c: 7 })
    expect(decodeSurveyToken(t, surveyId)).toEqual({ e: 'known@example.com', c: 7, s: surveyId })
    expect(decodeSurveyToken(t, 'other')).toBeNull()
    expect(decodeSurveyToken('garbage', surveyId)).toBeNull()
  })

  it('expands placeholders with one token per survey', () => {
    const html = `<a href="{{ survey_link:${surveyId} }}">Go</a><a href="{{ survey_answer:${surveyId}:nps:9 }}">9</a>`
    expect(referencedSurveyIds(html)).toEqual([surveyId])
    const out = expandSurveyPlaceholders(html, { appUrl: 'https://app.test', email: 'known@example.com', campaignId: 3 })
    const tokens = [...out.matchAll(/t=([^&"]+)/g)].map(m => decodeURIComponent(m[1]))
    expect(new Set(tokens).size).toBe(1)
    expect(out).toContain(`https://app.test/s/${surveyId}?t=`)
    expect(out).toContain('&amp;q=nps&amp;a=9')
    expect(decodeSurveyToken(tokens[0], surveyId)).toMatchObject({ e: 'known@example.com', c: 3 })
  })
})

describe('submitSurveyPage', () => {
  it('records a token response, follows logic and maps answers to the contact', () => {
    const t = token()
    const first = submitSurveyPage({ surveyId, t, source: 'email_inline', pageId: 'p1', answers: { nps: '10' } })
    expect(first).toMatchObject({ status: 200, body: { next: { kind: 'page', pageId: 'p3' }, completed: false } })
    // The inline answer already reached the contact.
    expect(db.getContact('known@example.com')?.custom?.nps).toBe(10)

    const second = submitSurveyPage({ surveyId, t, source: 'email', pageId: 'p3', answers: { co: 'NewCo' } })
    expect(second).toMatchObject({ status: 200, body: { completed: true } })

    const [response] = db.getSurveyResponses(surveyId)
    expect(response).toMatchObject({ status: 'completed', source: 'email_inline', contact_email: 'known@example.com', path: ['p1', 'p3'] })
    // if_empty never clobbers existing data.
    expect(db.getContact('known@example.com')?.company).toBe('Acme')
  })

  it('refuses a page the logic skips, and a second completion', () => {
    const t = token()
    submitSurveyPage({ surveyId, t, source: 'email', pageId: 'p1', answers: { nps: 9 } })
    expect(submitSurveyPage({ surveyId, t, source: 'email', pageId: 'p2', answers: { why: 'x' } }).status).toBe(409)
    submitSurveyPage({ surveyId, t, source: 'email', pageId: 'p3', answers: {} })
    expect(submitSurveyPage({ surveyId, t, source: 'email', pageId: 'p1', answers: { nps: 9 } }).status).toBe(409)
  })

  it('validates answers and rejects forged tokens', () => {
    expect(submitSurveyPage({ surveyId, t: token(), source: 'email', pageId: 'p1', answers: { nps: 11 } }).status).toBe(422)
    expect(submitSurveyPage({ surveyId, t: token({ s: 'other' }), source: 'email', pageId: 'p1', answers: { nps: 5 } }).status).toBe(403)
  })

  it('handles anonymous respondents with a resume key and identifies them by email', () => {
    const first = submitSurveyPage({ surveyId, source: 'link', pageId: 'p1', answers: { nps: 9 } })
    expect(first.status).toBe(200)
    const resumeKey = (first.body as { resumeKey: string }).resumeKey
    expect(resumeKey).toBeTruthy()

    // No list configured: an unknown email is not turned into a contact.
    const done = submitSurveyPage({ surveyId, resumeKey, source: 'link', pageId: 'p3', answers: { email: 'new@example.com' }, startedAt: Date.now() - 10_000 })
    expect(done).toMatchObject({ status: 200, body: { completed: true } })
    expect(db.getContact('new@example.com')).toBeNull()
    expect(db.getSurveyResponses(surveyId)[0].contact_email).toBeNull()
  })

  it('creates contacts from anonymous responses when a list is set', () => {
    updateSurvey(surveyId, { settings: { listId: 1 } })
    const r = submitSurveyPage({ surveyId, source: 'link', pageId: 'p1', answers: { nps: 9 }, startedAt: Date.now() - 10_000 })
    const resumeKey = (r.body as { resumeKey: string }).resumeKey
    submitSurveyPage({ surveyId, resumeKey, source: 'link', pageId: 'p3', answers: { email: 'Fresh@Example.com', co: 'FreshCo' } })
    expect(db.getContact('fresh@example.com')).toMatchObject({ status: 'subscribed', company: 'FreshCo', custom: { nps: 9 } })
    expect(db.data.list_contacts.some(lc => lc.list_id === 1 && lc.contact_email === 'fresh@example.com')).toBe(true)
  })

  it('rejects instant anonymous completions', () => {
    const result = submitSurveyPage({ surveyId, source: 'link', pageId: 'p1', answers: { nps: 2 } })
    expect(result.status).toBe(200) // not the last page
    const oneShot = db.addSurvey({ name: 'One', design: { ...design, pages: [design.pages[2]] }, settings: DEFAULT_SURVEY_SETTINGS })
    db.updateSurvey(oneShot.id, { status: 'published' })
    expect(submitSurveyPage({ surveyId: oneShot.id, source: 'link', pageId: 'p3', answers: {}, startedAt: Date.now() }).status).toBe(429)
  })

  it('keeps test responses out of contacts and counts, and lets them use drafts', () => {
    db.updateSurvey(surveyId, { status: 'draft' })
    const result = submitSurveyPage({ surveyId, t: token({ test: true }), source: 'email', pageId: 'p1', answers: { nps: 3 } })
    expect(result.status).toBe(200)
    expect(db.getContact('known@example.com')?.custom?.nps).toBeUndefined()
    expect(db.getSurveyResponseCount(surveyId)).toBe(0)
    expect(submitSurveyPage({ surveyId, t: token(), source: 'email', pageId: 'p1', answers: { nps: 3 } }).status).toBe(410)
  })
})

describe('structure lock', () => {
  it('blocks deleting answered questions once real responses exist', () => {
    submitSurveyPage({ surveyId, t: token(), source: 'email', pageId: 'p1', answers: { nps: 9 } })
    const without = { ...design, pages: design.pages.map(p => (p.id === 'p2' ? { ...p, blocks: [] } : p)) }
    expect(() => updateSurvey(surveyId, { design: without })).toThrow(/can't be deleted/)
  })
})

describe('loadPublicSurvey', () => {
  it('hides mappings, resumes partial token responses and 404s drafts', () => {
    const t = token()
    submitSurveyPage({ surveyId, t, source: 'email', pageId: 'p1', answers: { nps: 9 } })
    const loaded = loadPublicSurvey(surveyId, { t })
    expect(loaded.state).toBe('open')
    if (loaded.state !== 'open') return
    expect(JSON.stringify(loaded.survey)).not.toContain('custom:nps')
    expect(loaded.resume).toMatchObject({ answers: { nps: 9 }, pageId: 'p3' })

    db.updateSurvey(surveyId, { status: 'draft' })
    expect(loadPublicSurvey(surveyId, {}).state).toBe('not_found')
    expect(loadPublicSurvey(surveyId, { preview: true }).state).toBe('open')
  })
})

describe('createRateLimiter', () => {
  it('allows up to the limit per window', () => {
    const allow = createRateLimiter({ limit: 2, windowMs: 1000 })
    expect([allow('a', 0), allow('a', 1), allow('a', 2), allow('b', 2), allow('a', 1001)]).toEqual([true, true, false, true, true])
  })
})

describe('signed-in embeds', () => {
  it('issues a personal URL for an existing contact and answers the Email question from it', () => {
    const issued = issueEmbedToken({ surveyId, email: ' Known@Example.com ', appUrl: 'https://app.test' })
    expect(issued).toMatchObject({ status: 200, body: { contact: 'existing' } })
    if (issued.status !== 200) return
    expect(issued.body.url).toContain(`https://app.test/s/${surveyId}?embed=1&t=`)

    const t = issued.body.token
    const loaded = loadPublicSurvey(surveyId, { t })
    expect(loaded.state === 'open' && loaded.identified?.hiddenBlockIds).toEqual(['email'])

    submitSurveyPage({ surveyId, t, source: 'embed', pageId: 'p1', answers: { nps: 10 } })
    const done = submitSurveyPage({ surveyId, t, source: 'embed', pageId: 'p3', answers: { email: 'someone@else.com' } })
    expect(done).toMatchObject({ status: 200, body: { completed: true } })
    const [r] = db.getSurveyResponses(surveyId)
    // The token wins over anything the browser sends for the Email question.
    expect(r).toMatchObject({ source: 'embed', contact_email: 'known@example.com', answers: { email: 'known@example.com' } })
    expect(db.getContact('known@example.com')?.custom?.nps).toBe(10)
  })

  it('creates the contact only when the survey has a list', () => {
    expect(issueEmbedToken({ surveyId, email: 'nolist@example.com', appUrl: 'x' })).toMatchObject({ body: { contact: 'not_created' } })
    expect(db.getContact('nolist@example.com')).toBeNull()
    updateSurvey(surveyId, { settings: { listId: 1 } })
    expect(issueEmbedToken({ surveyId, email: 'withlist@example.com', firstName: 'Wil', appUrl: 'x' })).toMatchObject({ body: { contact: 'created' } })
    expect(db.getContact('withlist@example.com')).toMatchObject({ status: 'subscribed', first_name: 'Wil' })
  })

  it('rejects bad input, unpublished surveys and expired tokens', () => {
    expect(issueEmbedToken({ surveyId, email: 'nope', appUrl: 'x' }).status).toBe(400)
    expect(issueEmbedToken({ surveyId: 'missing', email: 'a@b.co', appUrl: 'x' }).status).toBe(404)
    const old = issueEmbedToken({ surveyId, email: 'known@example.com', appUrl: 'x', now: Date.now() - 25 * 3600_000 })
    if (old.status === 200) expect(submitSurveyPage({ surveyId, t: old.body.token, source: 'embed', pageId: 'p1', answers: { nps: 5 } }).status).toBe(403)
    db.updateSurvey(surveyId, { status: 'draft' })
    expect(issueEmbedToken({ surveyId, email: 'a@b.co', appUrl: 'x' }).status).toBe(409)
  })
})
