import type { SurveyBlock, SurveyDesign, SurveyResponse } from './types'
import { CHOICE_TYPES, isQuestionType } from './types'
import { answerToDisplay } from './logic/answers'
import { scaleRange } from './logic/validate'

export type QuestionSummary =
  | { kind: 'choice'; id: string; title: string; type: string; answered: number; options: Array<{ id: string; label: string; count: number }>; other: string[] }
  | {
      kind: 'nps'
      id: string
      title: string
      type: string
      answered: number
      score: number | null
      promoters: number
      passives: number
      detractors: number
      distribution: number[]
      /** NPS for each week with answers (weeks start on Monday), oldest first, the last twelve at most. */
      trend: Array<{ week: string; score: number; answered: number }>
    }
  | { kind: 'scale'; id: string; title: string; type: string; answered: number; average: number | null; min: number; distribution: number[] }
  | { kind: 'yes_no'; id: string; title: string; type: string; answered: number; yes: number; no: number }
  | { kind: 'number'; id: string; title: string; type: string; answered: number; average: number | null; min: number | null; max: number | null }
  | { kind: 'text'; id: string; title: string; type: string; answered: number; latest: Array<{ value: string; at: string; email: string | null }> }

export interface SurveySummary {
  started: number
  completed: number
  completionRate: number | null
  medianSeconds: number | null
  /**
   * Each page in order: how many responses reached it, how many stopped there
   * without finishing, and whether only a rule leads to it (so not reaching it
   * isn't anyone leaving).
   */
  pageReach: Array<{ pageId: string; title: string; reached: number; stopped: number; branch: boolean }>
  bySource: Record<string, number>
  questions: QuestionSummary[]
}

const TEXT_SAMPLE = 200

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The Monday (UTC) of the week a time falls in, as YYYY-MM-DD. */
function weekStart(iso: string): string {
  const d = new Date(iso)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
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
    const weeks = new Map<string, number[]>()
    for (const r of answered) {
      const v = r.answers[block.id]
      if (typeof v !== 'number') continue
      const week = weekStart(r.started_at)
      weeks.set(week, [...(weeks.get(week) ?? []), v])
    }
    const trend = [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([week, vs]) => ({ week, answered: vs.length, score: Math.round(((vs.filter(n => n >= 9).length - vs.filter(n => n <= 6).length) / vs.length) * 100) }))
    return { ...base, kind: 'nps', answered: nums.length, score, promoters, passives, detractors, distribution, trend }
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
 * Whether a page is only reached when logic sends people there: some earlier
 * page has a rule or a "go to" pointing at it, and the page before it doesn't
 * simply carry on into it.
 */
function isBranchPage(design: SurveyDesign, index: number): boolean {
  if (index === 0) return false
  const page = design.pages[index]
  const targets = (p: SurveyDesign['pages'][number]) => [...(p.rules ?? []).map(r => r.goTo), ...(p.defaultNext ? [p.defaultNext] : [])]
  const pointedAt = design.pages.slice(0, index).some(p => targets(p).some(t => t.kind === 'page' && t.pageId === page.id))
  const before = design.pages[index - 1]
  const fallsThrough = !before.defaultNext || before.defaultNext.kind === 'next'
  return pointedAt || !fallsThrough
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
      stopped: responses.filter(r => r.status === 'partial' && (r.current_page_id ?? r.path[r.path.length - 1] ?? design.pages[0]?.id) === p.id).length,
      branch: isBranchPage(design, i),
    })),
    bySource,
    questions: design.pages.flatMap(p => p.blocks.filter(b => isQuestionType(b.type)).map(b => summarizeQuestion(b, responses))),
  }
}
