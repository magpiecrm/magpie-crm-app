import type { AnswerValue, Answers, ChoiceAnswer, SurveyBlock, SurveyDesign, SurveyPage } from '../types'
import { isQuestionType } from '../types'
import { computePath, isAnswered } from './evaluate'

const TEXT_HARD_CAP = { short_text: 1000, long_text: 5000, email: 320 } as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type ValidationResult = { ok: true; value: AnswerValue } | { ok: false; error: string }

const fail = (error: string): ValidationResult => ({ ok: false, error })

/** Default range for scale-based questions. */
export function scaleRange(block: SurveyBlock): { min: number; max: number } {
  if (block.type === 'nps') return { min: 0, max: 10 }
  const scale = block.question?.scale
  if (block.type === 'rating') return { min: scale?.min ?? 1, max: scale?.max ?? 5 }
  return { min: scale?.min ?? 1, max: scale?.max ?? 7 }
}

function toChoice(raw: unknown): ChoiceAnswer | null {
  if (raw && typeof raw === 'object' && Array.isArray((raw as ChoiceAnswer).optionIds)) {
    const r = raw as ChoiceAnswer
    return {
      optionIds: r.optionIds.filter((x): x is string => typeof x === 'string'),
      ...(typeof r.other === 'string' ? { other: r.other } : {}),
    }
  }
  // Query-string input (email inline links) and single ids.
  if (typeof raw === 'string' && raw) return { optionIds: [raw] }
  if (Array.isArray(raw)) return { optionIds: raw.filter((x): x is string => typeof x === 'string') }
  return null
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Coerce and validate one raw answer (from JSON or a query string) against its
 * question. Empty answers pass here; `required` is enforced by `validatePage`.
 */
export function validateAnswer(block: SurveyBlock, raw: unknown): ValidationResult {
  const q = block.question
  if (!q || !isQuestionType(block.type)) return fail('Not a question')
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }

  switch (block.type) {
    case 'short_text':
    case 'long_text':
    case 'email': {
      if (typeof raw !== 'string') return fail('Expected text')
      let value = raw.trim()
      if (block.type === 'email') {
        value = value.toLowerCase()
        if (!EMAIL_RE.test(value)) return fail('Enter a valid email address')
      }
      if (value.length > TEXT_HARD_CAP[block.type]) return fail('Answer is too long')
      if (q.maxLength && value.length > q.maxLength) return fail(`Maximum ${q.maxLength} characters`)
      if (q.minLength && value.length < q.minLength) return fail(`Minimum ${q.minLength} characters`)
      return { ok: true, value }
    }

    case 'number': {
      const n = toNumber(raw)
      if (n === null) return fail('Enter a number')
      if (q.min !== undefined && n < q.min) return fail(`Minimum is ${q.min}`)
      if (q.max !== undefined && n > q.max) return fail(`Maximum is ${q.max}`)
      return { ok: true, value: n }
    }

    case 'date': {
      if (typeof raw !== 'string' || !DATE_RE.test(raw) || isNaN(Date.parse(raw))) return fail('Enter a valid date')
      return { ok: true, value: raw }
    }

    case 'rating':
    case 'nps':
    case 'scale': {
      const n = toNumber(raw)
      const { min, max } = scaleRange(block)
      if (n === null || !Number.isInteger(n) || n < min || n > max) return fail(`Pick a value from ${min} to ${max}`)
      return { ok: true, value: n }
    }

    case 'yes_no': {
      if (raw === true || raw === 'true' || raw === 'yes') return { ok: true, value: true }
      if (raw === false || raw === 'false' || raw === 'no') return { ok: true, value: false }
      return fail('Answer yes or no')
    }

    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice': {
      const choice = toChoice(raw)
      if (!choice) return fail('Pick an option')
      const valid = new Set((q.options ?? []).map(o => o.id))
      const ids = [...new Set(choice.optionIds)]
      if (ids.some(id => !valid.has(id))) return fail('Unknown option')
      const other = q.allowOther && block.type !== 'dropdown' ? choice.other?.trim().slice(0, 500) : undefined
      const count = ids.length + (other ? 1 : 0)
      if (count === 0) return { ok: true, value: null }
      if (block.type !== 'multiple_choice' && count > 1) return fail('Pick one option')
      if (block.type === 'multiple_choice') {
        if (q.minSelect && count < q.minSelect) return fail(`Pick at least ${q.minSelect}`)
        if (q.maxSelect && count > q.maxSelect) return fail(`Pick at most ${q.maxSelect}`)
      }
      return { ok: true, value: other ? { optionIds: ids, other } : { optionIds: ids } }
    }
  }
}

export type PageValidation = { ok: true; answers: Answers } | { ok: false; errors: Record<string, string> }

/**
 * Validate the answers to one page. Returns only that page's questions'
 * answers, coerced — anything else the client sent is dropped.
 */
export function validatePage(page: SurveyPage, raw: Record<string, unknown>): PageValidation {
  const answers: Answers = {}
  const errors: Record<string, string> = {}
  for (const block of page.blocks) {
    if (!isQuestionType(block.type) || !block.question) continue
    const result = validateAnswer(block, raw[block.id])
    if (!result.ok) {
      errors[block.id] = result.error
      continue
    }
    if (block.question.required && !isAnswered(result.value)) {
      errors[block.id] = 'This question is required'
      continue
    }
    if (result.value !== null) answers[block.id] = result.value
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers }
}

export type SubmissionValidation =
  | { ok: true; answers: Answers; path: string[] }
  | { ok: false; errors: Record<string, string>; path: string[] }

/**
 * Validate a whole submission: replay the logic, validate every page on the
 * resulting path, and drop answers to pages the respondent never reached.
 */
export function validateSubmission(design: SurveyDesign, raw: Record<string, unknown>): SubmissionValidation {
  // Coerce first so the logic replay sees typed values.
  const coerced: Answers = {}
  for (const page of design.pages) {
    for (const block of page.blocks) {
      if (!isQuestionType(block.type) || !(block.id in raw)) continue
      const result = validateAnswer(block, raw[block.id])
      if (result.ok && result.value !== null) coerced[block.id] = result.value
    }
  }

  const path = computePath(design, coerced)
  const answers: Answers = {}
  const errors: Record<string, string> = {}
  for (const pageId of path) {
    const page = design.pages.find(p => p.id === pageId)!
    const result = validatePage(page, raw)
    if (result.ok) Object.assign(answers, result.answers)
    else Object.assign(errors, result.errors)
  }
  return Object.keys(errors).length ? { ok: false, errors, path } : { ok: true, answers, path }
}
