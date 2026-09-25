import crypto from 'crypto'
import { db } from './db'
import { notify } from './notify'
import { isSurveyOpen } from './surveys'
import { decodeSurveyToken, type SurveyToken } from './surveyLinks'
import { applySurveyToContact } from './surveyContacts'
import type { Answers, ResponseSource, Survey, SurveyResponse } from '../features/survey-builder/types'
import { isQuestionType } from '../features/survey-builder/types'
import { computePath, resolveNext, type NextStep } from '../features/survey-builder/logic/evaluate'
import { validatePage, validateSubmission } from '../features/survey-builder/logic/validate'

export interface SubmitPageInput {
  surveyId: string
  /** Per-recipient token from an email link. */
  t?: string | null
  /** Anonymous respondents' resume key, issued by the first submit. */
  resumeKey?: string | null
  source: ResponseSource
  pageId: string
  answers: Record<string, unknown>
  /** Honeypot; bots fill it in. */
  hp?: string
  /** When the respondent's page loaded (ms epoch), for the too-fast check. */
  startedAt?: number
  referrer?: string
}

export type SubmitPageResult =
  | { status: 200; body: { responseId: string; resumeKey?: string; next: NextStep; completed: boolean } }
  | { status: 400 | 403 | 404 | 409 | 410 | 422 | 429; body: { error: string; errors?: Record<string, string> } }

const MIN_ANON_SECONDS = 2
const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex')

/** The email identifying a response: the token's, else (if enabled) the answered Email question. */
function identifyEmail(survey: Survey, token: SurveyToken | null, answers: Answers): string | null {
  if (token) return token.e
  if (!survey.settings.identifyContacts) return null
  for (const page of survey.design.pages) {
    for (const block of page.blocks) {
      const value = answers[block.id]
      if (block.type === 'email' && typeof value === 'string' && value) return value
    }
  }
  return null
}

/**
 * Save one page of a survey response. Pure request → result so the HTTP route
 * stays a thin adapter and this can be tested directly.
 *
 * The server replays the skip logic itself rather than trusting the client:
 * a page is only accepted if the current answers actually lead to it, and on
 * completion answers to pages the logic skipped are dropped.
 */
export function submitSurveyPage(input: SubmitPageInput): SubmitPageResult {
  const survey = db.getSurvey(input.surveyId)
  if (!survey) return { status: 404, body: { error: 'Survey not found' } }

  const token = input.t ? decodeSurveyToken(input.t, survey.id) : null
  if (input.t && !token) return { status: 403, body: { error: 'This survey link is not valid.' } }
  const isTest = !!token?.test

  // Test sends are allowed to exercise draft surveys end to end.
  if (!isSurveyOpen(survey) && !(isTest && survey.status === 'draft')) {
    return { status: 410, body: { error: 'This survey is closed.' } }
  }

  const page = survey.design.pages.find(p => p.id === input.pageId)
  if (!page) return { status: 400, body: { error: 'Unknown page' } }

  // --- Find or start the response ---
  const now = new Date().toISOString()
  let response: SurveyResponse | null = null
  let issuedResumeKey: string | undefined

  if (token) {
    response = db.findSurveyResponse(survey.id, token.e, token.c)
  } else if (input.resumeKey) {
    response = db.findSurveyResponseByResumeHash(survey.id, hashKey(input.resumeKey))
  }

  if (response?.status === 'completed') {
    const restarting = input.pageId === survey.design.pages[0]?.id
    if (!survey.settings.allowMultipleResponses && token && !isTest) {
      return { status: 409, body: { error: "You've already completed this survey. Thank you!" } }
    }
    if (!restarting) return { status: 409, body: { error: 'This response has already been submitted.' } }
    response = null
  }

  const isNew = !response
  if (!response) {
    if (!token) issuedResumeKey = crypto.randomBytes(24).toString('base64url')
    response = {
      id: crypto.randomUUID(),
      survey_id: survey.id,
      contact_email: token?.e ?? null,
      source: token?.src === 'embed' ? 'embed' : input.source,
      campaign_id: token?.c ?? null,
      status: 'partial',
      answers: {},
      path: [],
      current_page_id: null,
      resume_key_hash: issuedResumeKey ? hashKey(issuedResumeKey) : null,
      started_at: now,
      updated_at: now,
      completed_at: null,
      meta: { ...(isTest ? { test: true } : {}), ...(input.referrer ? { referrer: input.referrer.slice(0, 500) } : {}) },
    }
  }

  // --- Validate and merge this page ---
  // An identified respondent never sees the Email question; answer it from the token.
  const raw: Record<string, unknown> = { ...(input.answers ?? {}) }
  if (token) {
    for (const block of page.blocks) if (block.type === 'email') raw[block.id] = token.e
  }
  const pageResult = validatePage(page, raw)
  if (!pageResult.ok) return { status: 422, body: { error: 'Please check your answers.', errors: pageResult.errors } }

  const merged: Answers = { ...response.answers }
  for (const block of page.blocks) {
    if (isQuestionType(block.type)) delete merged[block.id]
  }
  Object.assign(merged, pageResult.answers)

  const path = computePath(survey.design, merged, page.id)
  if (path[path.length - 1] !== page.id) {
    return { status: 409, body: { error: 'Your earlier answers skip this page. Please go back and review them.' } }
  }

  const next = resolveNext(survey.design, page.id, merged)
  const completing = next.kind === 'end'

  if (completing && !token) {
    const elapsed = input.startedAt ? (Date.now() - input.startedAt) / 1000 : 0
    if (isNew && elapsed < MIN_ANON_SECONDS) {
      return { status: 429, body: { error: 'That was quick! Please take a moment and submit again.' } }
    }
  }

  let answers = merged
  if (completing) {
    const full = validateSubmission(survey.design, merged)
    if (!full.ok) return { status: 422, body: { error: 'Some earlier answers need attention.', errors: full.errors } }
    answers = full.answers
  }

  // --- Contact identity and write-back (never for test responses) ---
  const email = identifyEmail(survey, token, answers)
  if (email && !isTest) {
    // Token respondents are already contacts; anonymous ones are only created when a list is set (like Forms).
    const { created } = applySurveyToContact(survey, answers, email, { allowCreate: !token && !!survey.settings.listId })
    if (db.getContact(email)) response.contact_email = email
    if (created) notify('contact_added', `${email} joined via survey "${survey.name}"`, { contactEmail: email })
  } else if (email) {
    response.contact_email = email
  }

  Object.assign(response, {
    answers,
    path: computePath(survey.design, answers, completing ? undefined : page.id),
    current_page_id: completing ? null : next.kind === 'page' ? next.pageId : null,
    status: completing ? 'completed' : 'partial',
    completed_at: completing ? now : null,
    updated_at: now,
  } satisfies Partial<SurveyResponse>)
  db.saveSurveyResponse(response)

  if (completing && !isTest && survey.settings.notifyOnResponse) {
    const who = response.contact_email ?? 'Someone'
    notify('survey_response', `${who} completed "${survey.name}"`, {
      url: `/marketing/surveys/${survey.id}`,
      contactEmail: response.contact_email ?? undefined,
    })
  }

  return {
    status: 200,
    body: { responseId: response.id, ...(issuedResumeKey ? { resumeKey: issuedResumeKey } : {}), next, completed: completing },
  }
}

/** Survey data safe to send to an anonymous browser: no contact mappings, list ids or other internals. */
function publicSurveyPayload(survey: Survey) {
  return {
    id: survey.id,
    name: survey.name,
    design: {
      theme: survey.design.theme,
      pages: survey.design.pages.map(p => ({
        ...p,
        blocks: p.blocks.map(b => (b.question ? { ...b, question: { ...b.question, mapTo: undefined } } : b)),
      })),
    },
    settings: { allowBack: survey.settings.allowBack, thankYou: survey.settings.thankYou },
  }
}

/**
 * Everything the hosted page needs on load. A valid token also counts as a
 * campaign click and resumes that respondent's existing response.
 */
export type PublicSurveyLoad =
  | { state: 'not_found' }
  | { state: 'closed'; name: string }
  | { state: 'invalid_link'; name: string }
  | {
      state: 'open'
      survey: ReturnType<typeof publicSurveyPayload>
      completed: boolean
      resume: { answers: Answers; pageId: string | null; path: string[] } | null
      /** Email questions answered by the token, hidden from the respondent. */
      identified: { answers: Answers; hiddenBlockIds: string[] } | null
    }

export function loadPublicSurvey(
  surveyId: string,
  opts: { t?: string | null; resumeKey?: string | null; preview?: boolean },
): PublicSurveyLoad {
  const survey = db.getSurvey(surveyId)
  if (!survey) return { state: 'not_found' }

  const token = opts.t ? decodeSurveyToken(opts.t, survey.id) : null
  const open = isSurveyOpen(survey) || opts.preview || (token?.test && survey.status === 'draft')
  if (!open) return survey.status === 'draft' ? { state: 'not_found' } : { state: 'closed', name: survey.name }
  if (opts.t && !token) return { state: 'invalid_link', name: survey.name }

  let existing: SurveyResponse | null = null
  if (token) {
    existing = db.findSurveyResponse(survey.id, token.e, token.c)
    if (token.c !== null && !token.test) db.markRecipientClicked(token.e, token.c)
  } else if (opts.resumeKey) {
    existing = db.findSurveyResponseByResumeHash(survey.id, hashKey(opts.resumeKey))
  }

  const completed = existing?.status === 'completed' && !survey.settings.allowMultipleResponses && !!token && !token.test
  const emailBlocks = token ? survey.design.pages.flatMap(p => p.blocks.filter(b => b.type === 'email')) : []
  return {
    state: 'open',
    survey: publicSurveyPayload(survey),
    completed,
    resume:
      existing && existing.status === 'partial'
        ? { answers: existing.answers, pageId: existing.current_page_id, path: existing.path }
        : null,
    identified: token
      ? { answers: Object.fromEntries(emailBlocks.map(b => [b.id, token.e])), hiddenBlockIds: emailBlocks.map(b => b.id) }
      : null,
  }
}
