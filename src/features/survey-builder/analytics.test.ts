import { describe, expect, it } from 'vitest'
import type { SurveyBlock, SurveyDesign, SurveyPage, SurveyResponse } from './types'
import { DEFAULT_SURVEY_THEME } from './types'
import { canSkipPage, computeSurveySummary, headlineSummary, isBranchPage, pickHeadline, reachedPage } from './analytics'

const q = (id: string): SurveyBlock => ({ id, type: 'short_text', question: { title: id, required: false } })
const page = (id: string, extra: Partial<SurveyPage> = {}): SurveyPage => ({ id, blocks: [q(`${id}q`)], ...extra })
const survey = (...pages: SurveyPage[]): SurveyDesign => ({ theme: DEFAULT_SURVEY_THEME, pages })

let n = 0
const response = (extra: Partial<SurveyResponse>): SurveyResponse =>
  ({
    id: `r${++n}`,
    survey_id: 's',
    status: 'partial',
    answers: {},
    path: [],
    current_page_id: null,
    source: 'link',
    contact_email: null,
    started_at: '2026-11-02T10:00:00.000Z',
    updated_at: '2026-11-02T10:00:00.000Z',
    completed_at: null,
    ...extra,
  }) as SurveyResponse

describe('isBranchPage', () => {
  it('is a page only a jump reaches', () => {
    // p1's rule jumps to p3; p2 goes to the end, so nobody carries on into p3.
    const design = survey(page('p1', { rules: [{ id: 'r', when: { questionId: 'p1q', op: 'answered' }, goTo: { kind: 'page', pageId: 'p3' } }] }), page('p2', { defaultNext: { kind: 'end' } }), page('p3'))
    expect(isBranchPage(design, 2)).toBe(true)
  })

  it("isn't a page the one before carries on into, even when a rule also points at it", () => {
    const rule = { id: 'r', when: { questionId: 'p1q', op: 'answered' as const }, goTo: { kind: 'page' as const, pageId: 'p3' } }
    expect(isBranchPage(survey(page('p1', { rules: [rule] }), page('p2'), page('p3')), 2)).toBe(false)
    // The page before sends everyone there by name.
    expect(isBranchPage(survey(page('p1', { rules: [rule] }), page('p2', { defaultNext: { kind: 'page', pageId: 'p3' } }), page('p3')), 2)).toBe(false)
  })

  it("isn't the first page, or one nothing points at", () => {
    const design = survey(page('p1'), page('p2'))
    expect(isBranchPage(design, 0)).toBe(false)
    expect(isBranchPage(design, 1)).toBe(false)
  })
})

describe('canSkipPage', () => {
  it('is a page an earlier rule or "go to" jumps past', () => {
    const design = survey(page('p1', { rules: [{ id: 'r', when: { questionId: 'p1q', op: 'answered' }, goTo: { kind: 'page', pageId: 'p3' } }] }), page('p2'), page('p3'))
    expect(canSkipPage(design, 1)).toBe(true)
    expect(canSkipPage(design, 2)).toBe(false)
    expect(canSkipPage(survey(page('p1', { defaultNext: { kind: 'end' } }), page('p2')), 1)).toBe(true)
  })

  it("is never a page in a survey without logic", () => {
    const design = survey(page('p1'), page('p2'), page('p3'))
    expect([0, 1, 2].map(i => canSkipPage(design, i))).toEqual([false, false, false])
  })
})

describe('reachedPage', () => {
  it('counts a response that has sent nothing yet as on the first page', () => {
    const fresh = { path: [], current_page_id: null }
    expect(reachedPage(fresh, 'p1', true)).toBe(true)
    expect(reachedPage(fresh, 'p2', false)).toBe(false)
    expect(reachedPage({ path: ['p1'], current_page_id: 'p2' }, 'p2', false)).toBe(true)
  })
})

describe('computeSurveySummary', () => {
  it('says a question is skippable only when logic can take people past it', () => {
    const plain = survey(page('p1'), page('p2'), page('p3'))
    // One stopped on p2: p3's question was seen by fewer, but no logic hides it.
    const responses = [response({ status: 'completed', path: ['p1', 'p2', 'p3'] }), response({ path: ['p1'], current_page_id: 'p2' })]
    const summary = computeSurveySummary(plain, responses)
    const p3 = summary.questions.find(x => x.id === 'p3q')!
    expect(p3.seen).toBe(1)
    expect(p3.skippable).toBe(false)

    const branched = survey(page('p1', { rules: [{ id: 'r', when: { questionId: 'p1q', op: 'answered' }, goTo: { kind: 'end' } }] }), page('p2'))
    expect(computeSurveySummary(branched, responses).questions.find(x => x.id === 'p2q')!.skippable).toBe(true)
  })
})

describe('NPS week by week', () => {
  it('scores each week from its own answers', () => {
    const design = survey({ id: 'p1', blocks: [{ id: 'nps', type: 'nps', question: { title: 'NPS', required: true } }] })
    const at = (iso: string, v: number) => response({ status: 'completed', path: ['p1'], started_at: iso, answers: { nps: v } })
    const responses = [at('2026-11-02T09:00:00Z', 10), at('2026-11-03T09:00:00Z', 3), at('2026-11-04T09:00:00Z', 9), at('2026-11-10T09:00:00Z', 8)]
    const q = computeSurveySummary(design, responses).questions[0]
    expect(q.kind === 'nps' && q.trend).toEqual([
      { week: '2026-11-02', answered: 3, score: 33 },
      { week: '2026-11-09', answered: 1, score: 0 },
    ])
    expect(q.kind === 'nps' && q.distribution).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1])
  })
})

describe('the headline', () => {
  const nps = (id: string): SurveyBlock => ({ id, type: 'nps', question: { title: id, required: false } })
  const rating: SurveyBlock = { id: 'stars', type: 'rating', question: { title: 'Stars', required: false, scale: { min: 1, max: 5 } } }
  const design = survey({ id: 'p1', blocks: [nps('first'), rating] }, { id: 'p2', blocks: [nps('second')] })

  it('is the first NPS with a score, as the results page and the list both pick it', () => {
    const responses = [response({ status: 'completed', path: ['p1', 'p2'], answers: { second: 10, stars: 4 } })]
    expect(headlineSummary(design, responses)?.id).toBe('second')
    expect(pickHeadline(computeSurveySummary(design, responses).questions)?.id).toBe('second')
  })

  it('falls back to the first rating or scale with an average', () => {
    const responses = [response({ status: 'completed', path: ['p1', 'p2'], answers: { stars: 4 } })]
    const q = headlineSummary(design, responses)
    expect(q?.id).toBe('stars')
    expect(q?.kind === 'scale' && q.average).toBe(4)
  })
})
