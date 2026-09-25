import type { AnswerValue, Answers, Condition, SurveyBlock, SurveyDesign, SurveyPage } from '../types'
import { isQuestionType } from '../types'

/** Every question block in the survey, in page order. */
export function questionBlocks(design: SurveyDesign): Array<{ page: SurveyPage; block: SurveyBlock }> {
  return design.pages.flatMap(page =>
    page.blocks.filter(b => isQuestionType(b.type)).map(block => ({ page, block })),
  )
}

export function findQuestion(design: SurveyDesign, questionId: string): SurveyBlock | undefined {
  for (const page of design.pages) {
    const hit = page.blocks.find(b => b.id === questionId && isQuestionType(b.type))
    if (hit) return hit
  }
  return undefined
}

export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'object') return value.optionIds.length > 0 || !!value.other?.trim()
  return true
}

/** Option ids for choice answers, else the scalar itself. */
function comparable(value: AnswerValue | undefined): Array<string | number | boolean> {
  if (value === undefined || value === null) return []
  if (typeof value === 'object') return value.optionIds
  return [value]
}

export function evaluateCondition(condition: Condition, answers: Answers): boolean {
  if ('all' in condition) return condition.all.every(c => evaluateCondition(c, answers))
  if ('any' in condition) return condition.any.some(c => evaluateCondition(c, answers))

  const value = answers[condition.questionId]
  const values = comparable(value)
  const target = condition.value

  switch (condition.op) {
    case 'answered':
      return isAnswered(value)
    case 'not_answered':
      return !isAnswered(value)
    case 'eq':
      // A choice answer "equals" an option when it is the only one picked.
      return values.length === 1 && values[0] === target
    case 'neq':
      return !(values.length === 1 && values[0] === target)
    case 'includes':
      return values.includes(target as string)
    case 'not_includes':
      return !values.includes(target as string)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof value !== 'number' || typeof target !== 'number') return false
      if (condition.op === 'gt') return value > target
      if (condition.op === 'gte') return value >= target
      if (condition.op === 'lt') return value < target
      return value <= target
    }
  }
}

export type NextStep = { kind: 'page'; pageId: string } | { kind: 'end' }

/**
 * Where to go after `pageId`: the first matching rule, then the page's
 * default, then the next page by index, then the end.
 */
export function resolveNext(design: SurveyDesign, pageId: string, answers: Answers): NextStep {
  const index = design.pages.findIndex(p => p.id === pageId)
  if (index === -1) return { kind: 'end' }
  const page = design.pages[index]

  const matched = page.rules?.find(rule => evaluateCondition(rule.when, answers))
  const target = matched?.goTo ?? page.defaultNext ?? { kind: 'next' as const }

  if (target.kind === 'end') return { kind: 'end' }
  if (target.kind === 'page' && design.pages.some(p => p.id === target.pageId)) {
    return { kind: 'page', pageId: target.pageId }
  }
  const next = design.pages[index + 1]
  return next ? { kind: 'page', pageId: next.id } : { kind: 'end' }
}

/**
 * Replay the survey from the first page with the given answers and return the
 * page ids a respondent would visit, stopping at `upToPageId` if given.
 *
 * The server uses this rather than trusting the client's path, so answers to
 * pages the logic skipped are never accepted. Capped at one visit per page so
 * a bad rule can never loop.
 */
export function computePath(design: SurveyDesign, answers: Answers, upToPageId?: string): string[] {
  const path: string[] = []
  let current: string | undefined = design.pages[0]?.id
  while (current && !path.includes(current) && path.length < design.pages.length) {
    path.push(current)
    if (current === upToPageId) break
    const next = resolveNext(design, current, answers)
    current = next.kind === 'page' ? next.pageId : undefined
  }
  return path
}
