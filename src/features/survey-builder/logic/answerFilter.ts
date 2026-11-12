import type { AnswerValue, SurveyBlock, SurveyDesign } from '../types'
import { CHOICE_TYPES, isQuestionType } from '../types'
import { scaleRange } from './validate'

/** One answer to narrow results to: a question and one of its answers ("Q1 · Detractors"). */
export interface AnswerFilter {
  questionId: string
  value: string
}

/**
 * The answers a question's results can be narrowed to, for the filter menu:
 * an NPS question's three groups, each rating or scale mark, Yes and No, or
 * each choice (and Other). Text, number and date questions have none.
 */
function answerFilterOptions(block: SurveyBlock): Array<{ value: string; label: string }> {
  if (block.type === 'nps') {
    return [
      { value: 'detractor', label: 'Detractors (0–6)' },
      { value: 'passive', label: 'Passives (7–8)' },
      { value: 'promoter', label: 'Promoters (9–10)' },
    ]
  }
  if (block.type === 'rating' || block.type === 'scale') {
    const { min, max } = scaleRange(block)
    return Array.from({ length: max - min + 1 }, (_, i) => ({ value: String(min + i), label: block.type === 'rating' ? `${min + i} of ${max} stars` : `${min + i}` }))
  }
  if (block.type === 'yes_no') {
    return [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ]
  }
  if (CHOICE_TYPES.includes(block.type as never)) {
    return [...(block.question?.options ?? []).map(o => ({ value: o.id, label: o.label })), ...(block.question?.allowOther ? [{ value: 'other', label: 'Other' }] : [])]
  }
  return []
}

/** Whether one answer matches a filter value from `answerFilterOptions`. */
export function matchesAnswer(block: SurveyBlock, answer: AnswerValue | undefined, value: string): boolean {
  if (answer === undefined || answer === null) return false
  if (block.type === 'nps' && typeof answer === 'number') return value === (answer <= 6 ? 'detractor' : answer <= 8 ? 'passive' : 'promoter')
  if ((block.type === 'rating' || block.type === 'scale') && typeof answer === 'number') return String(answer) === value
  if (block.type === 'yes_no' && typeof answer === 'boolean') return (answer ? 'yes' : 'no') === value
  if (typeof answer === 'object') return value === 'other' ? answer.other !== undefined : answer.optionIds.includes(value)
  return false
}

/** The questions that can be filtered on, with their number and options, in survey order. */
export function filterableQuestions(design: SurveyDesign): Array<{ block: SurveyBlock; n: number; options: Array<{ value: string; label: string }> }> {
  let n = 0
  return design.pages.flatMap(p =>
    p.blocks
      .filter(b => isQuestionType(b.type))
      .map(b => ({ block: b, n: ++n, options: answerFilterOptions(b) }))
      .filter(q => q.options.length > 0),
  )
}
