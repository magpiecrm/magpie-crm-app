import type { SurveyBlock, SurveyDesign, SurveyResponse } from './types'
import { CHOICE_TYPES, isQuestionType } from './types'
import { answerToDisplay } from './logic/answers'
import { scaleRange } from './logic/validate'

export type QuestionSummary =
  | { kind: 'choice'; id: string; title: string; type: string; answered: number; options: Array<{ id: string; label: string; count: number }>; other: string[] }
  | { kind: 'nps'; id: string; title: string; type: string; answered: number; score: number | null; promoters: number; passives: number; detractors: number; distribution: number[] }
  | { kind: 'scale'; id: string; title: string; type: string; answered: number; average: number | null; min: number; distribution: number[] }
  | { kind: 'yes_no'; id: string; title: string; type: string; answered: number; yes: number; no: number }
  | { kind: 'number'; id: string; title: string; type: string; answered: number; average: number | null; min: number | null; max: number | null }
  | { kind: 'text'; id: string; title: string; type: string; answered: number; latest: Array<{ value: string; at: string; email: string | null }> }

export interface SurveySummary {
  started: number
  completed: number
  completionRate: number | null
  medianSeconds: number | null
  /** How many responses reached each page, in page order. */
  pageReach: Array<{ pageId: string; title: string; reached: number }>
  bySource: Record<string, number>
  questions: QuestionSummary[]
}

const TEXT_SAMPLE = 50

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function summarizeQuestion(block: SurveyBlock, responses: SurveyResponse[]): QuestionSummary {
  const base = { id: block.id, title: block.question?.title || 'Untitled question', type: block.type }
  const answered = responses.filter(r => r.answers[block.id] !== undefined && r.answers[block.id] !== null)
  const values = answered.map(r => r.answers[block.id])

  if (CHOICE_TYPES.includes(block.type as never)) {
    const counts = new Map<string, number>()
    const other: string[] = []
    for (const v of values) {
      if (!v || typeof v !== 'object') continue
      v.optionIds.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1))
      if (v.other) other.push(v.other)
    }
    const known = (block.question?.options ?? []).map(o => ({ id: o.id, label: o.label, count: counts.get(o.id) ?? 0 }))
    return { ...base, kind: 'choice', answered: answered.length, options: known, other: other.slice(-TEXT_SAMPLE) }
  }

  const nums = values.filter((v): v is number => typeof v === 'number')

  if (block.type === 'nps') {
    const distribution = Array.from({ length: 11 }, (_, i) => nums.filter(n => n === i).length)
    const promoters = nums.filter(n => n >= 9).length
    const detractors = nums.filter(n => n <= 6).length
    const passives = nums.length - promoters - detractors
    const score = nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : null
    return { ...base, kind: 'nps', answered: nums.length, score, promoters, passives, detractors, distribution }
  }

  if (block.type === 'rating' || block.type === 'scale') {
    const { min, max } = scaleRange(block)
    const distribution = Array.from({ length: max - min + 1 }, (_, i) => nums.filter(n => n === min + i).length)
    const average = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null
    return { ...base, kind: 'scale', answered: nums.length, average, min, distribution }
  }

  if (block.type === 'yes_no') {
    const yes = values.filter(v => v === true).length
    const no = values.filter(v => v === false).length
    return { ...base, kind: 'yes_no', answered: yes + no, yes, no }
  }

  if (block.type === 'number') {
    const average = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null
    return { ...base, kind: 'number', answered: nums.length, average, min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null }
  }

  const latest = [...answered]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, TEXT_SAMPLE)
    .map(r => ({ value: answerToDisplay(block, r.answers[block.id]), at: r.updated_at, email: r.contact_email }))
  return { ...base, kind: 'text', answered: answered.length, latest }
}

/**
 * Aggregate results for the summary tab and the copilot's `getSurveyResults`.
 * Partial responses count towards per-question results — an NPS score answered
 * inline in an email is real data even if the follow-up page was skipped.
 */
export function computeSurveySummary(design: SurveyDesign, responses: SurveyResponse[]): SurveySummary {
  const completed = responses.filter(r => r.status === 'completed')
  const durations = completed
    .filter(r => r.completed_at)
    .map(r => (Date.parse(r.completed_at!) - Date.parse(r.started_at)) / 1000)
    .filter(s => s >= 0)

  const bySource: Record<string, number> = {}
  for (const r of responses) bySource[r.source] = (bySource[r.source] ?? 0) + 1

  return {
    started: responses.length,
    completed: completed.length,
    completionRate: responses.length ? Math.round((completed.length / responses.length) * 100) : null,
    medianSeconds: median(durations),
    pageReach: design.pages.map((p, i) => ({
      pageId: p.id,
      title: p.title || `Page ${i + 1}`,
      // `path` holds submitted pages; a partial response is also sitting on its current page.
      reached: responses.filter(r => r.path.includes(p.id) || r.current_page_id === p.id || (i === 0 && r.path.length === 0)).length,
    })),
    bySource,
    questions: design.pages.flatMap(p => p.blocks.filter(b => isQuestionType(b.type)).map(b => summarizeQuestion(b, responses))),
  }
}
