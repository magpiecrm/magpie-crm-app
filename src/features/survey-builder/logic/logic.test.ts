import { describe, expect, it } from 'vitest'
import type { SurveyBlock, SurveyDesign } from '../types'
import { DEFAULT_SURVEY_THEME } from '../types'
import { computePath, evaluateCondition, resolveNext } from './evaluate'
import { validateAnswer, validatePage, validateSubmission } from './validate'
import { answerToDisplay, coerceForField } from './answers'
import { lintSurvey } from './lint'

const nps: SurveyBlock = { id: 'nps', type: 'nps', question: { title: 'NPS', required: true } }
const why: SurveyBlock = { id: 'why', type: 'long_text', question: { title: 'Why?', required: true } }
const love: SurveyBlock = { id: 'love', type: 'long_text', question: { title: 'Love?', required: false } }
const colour: SurveyBlock = {
  id: 'colour',
  type: 'single_choice',
  question: { title: 'Colour', required: false, options: [{ id: 'r', label: 'Red' }, { id: 'b', label: 'Blue' }], allowOther: true },
}

// p1 (nps) → detractors (≤6) go to p2 then end; everyone else skips to p3.
const design: SurveyDesign = {
  theme: DEFAULT_SURVEY_THEME,
  pages: [
    {
      id: 'p1',
      blocks: [nps],
      rules: [{ id: 'r1', when: { questionId: 'nps', op: 'lte', value: 6 }, goTo: { kind: 'page', pageId: 'p2' } }],
      defaultNext: { kind: 'page', pageId: 'p3' },
    },
    { id: 'p2', blocks: [why], defaultNext: { kind: 'end' } },
    { id: 'p3', blocks: [love, colour] },
  ],
}

describe('evaluateCondition', () => {
  it('handles numeric, choice and nested conditions', () => {
    expect(evaluateCondition({ questionId: 'nps', op: 'gte', value: 9 }, { nps: 9 })).toBe(true)
    expect(evaluateCondition({ questionId: 'nps', op: 'gte', value: 9 }, { nps: '9' as any })).toBe(false)
    expect(evaluateCondition({ questionId: 'c', op: 'includes', value: 'r' }, { c: { optionIds: ['r', 'b'] } })).toBe(true)
    expect(evaluateCondition({ questionId: 'c', op: 'eq', value: 'r' }, { c: { optionIds: ['r', 'b'] } })).toBe(false)
    expect(evaluateCondition({ questionId: 'x', op: 'not_answered' }, { x: '  ' })).toBe(true)
    expect(
      evaluateCondition(
        { any: [{ questionId: 'a', op: 'eq', value: true }, { all: [{ questionId: 'b', op: 'answered' }, { questionId: 'nps', op: 'lt', value: 3 }] }] },
        { a: false, b: 'x', nps: 1 },
      ),
    ).toBe(true)
  })
})

describe('resolveNext / computePath', () => {
  it('uses the first matching rule, then defaultNext', () => {
    expect(resolveNext(design, 'p1', { nps: 3 })).toEqual({ kind: 'page', pageId: 'p2' })
    expect(resolveNext(design, 'p1', { nps: 9 })).toEqual({ kind: 'page', pageId: 'p3' })
    expect(resolveNext(design, 'p2', {})).toEqual({ kind: 'end' })
    expect(resolveNext(design, 'p3', {})).toEqual({ kind: 'end' })
  })

  it('replays the path and stops at the requested page', () => {
    expect(computePath(design, { nps: 3 })).toEqual(['p1', 'p2'])
    expect(computePath(design, { nps: 10 })).toEqual(['p1', 'p3'])
    expect(computePath(design, { nps: 10 }, 'p1')).toEqual(['p1'])
  })

  it('never loops on a backwards rule', () => {
    const loop: SurveyDesign = {
      ...design,
      pages: [
        { id: 'a', blocks: [] },
        { id: 'b', blocks: [], defaultNext: { kind: 'page', pageId: 'a' } },
      ],
    }
    expect(computePath(loop, {})).toEqual(['a', 'b'])
  })
})

describe('validateAnswer', () => {
  it('coerces query-string input', () => {
    expect(validateAnswer(nps, '7')).toEqual({ ok: true, value: 7 })
    expect(validateAnswer(nps, '11').ok).toBe(false)
    expect(validateAnswer({ id: 'y', type: 'yes_no', question: { title: '', required: false } }, 'true')).toEqual({ ok: true, value: true })
    expect(validateAnswer(colour, 'r')).toEqual({ ok: true, value: { optionIds: ['r'] } })
  })

  it('rejects unknown options and multiple picks on single choice', () => {
    expect(validateAnswer(colour, 'zzz').ok).toBe(false)
    expect(validateAnswer(colour, { optionIds: ['r', 'b'] }).ok).toBe(false)
    expect(validateAnswer(colour, { optionIds: [], other: 'Green' })).toEqual({ ok: true, value: { optionIds: [], other: 'Green' } })
  })

  it('normalises email', () => {
    const email: SurveyBlock = { id: 'e', type: 'email', question: { title: '', required: false } }
    expect(validateAnswer(email, ' Bob@Example.COM ')).toEqual({ ok: true, value: 'bob@example.com' })
    expect(validateAnswer(email, 'nope').ok).toBe(false)
  })
})

describe('validatePage / validateSubmission', () => {
  it('enforces required and drops unrelated keys', () => {
    expect(validatePage(design.pages[0], {})).toEqual({ ok: false, errors: { nps: 'This question is required' } })
    expect(validatePage(design.pages[0], { nps: 8, why: 'sneaky' })).toEqual({ ok: true, answers: { nps: 8 } })
  })

  it('drops answers to pages the logic skipped', () => {
    const result = validateSubmission(design, { nps: 10, why: 'should be dropped', love: 'great' })
    expect(result).toEqual({ ok: true, answers: { nps: 10, love: 'great' }, path: ['p1', 'p3'] })
  })

  it('only requires questions on the path', () => {
    expect(validateSubmission(design, { nps: 9 }).ok).toBe(true)
    expect(validateSubmission(design, { nps: 2 }).ok).toBe(false)
  })
})

describe('answers', () => {
  it('formats and coerces for contact fields', () => {
    expect(answerToDisplay(colour, { optionIds: ['b'], other: 'Teal' })).toBe('Blue, Other: Teal')
    expect(coerceForField(nps, 9, { key: 'nps', label: 'NPS', type: 'number', created_at: '' })).toBe(9)
    expect(coerceForField(nps, 9)).toBe('9')
    expect(coerceForField(colour, { optionIds: ['r'] }, { key: 'c', label: 'C', type: 'select', options: ['Red'], created_at: '' })).toBe('Red')
    expect(coerceForField(colour, { optionIds: ['b'] }, { key: 'c', label: 'C', type: 'select', options: ['Red'], created_at: '' })).toBeUndefined()
  })
})

describe('lintSurvey', () => {
  it('passes the sample design', () => {
    expect(lintSurvey(design).filter(i => i.level === 'error')).toEqual([])
  })

  it('flags backwards jumps, missing questions and bad mappings', () => {
    const bad: SurveyDesign = {
      ...design,
      pages: [
        { id: 'a', blocks: [{ ...nps, question: { ...nps.question!, mapTo: { field: 'custom:gone', overwrite: 'always' } } }] },
        {
          id: 'b',
          blocks: [],
          rules: [{ id: 'r', when: { questionId: 'deleted', op: 'answered' }, goTo: { kind: 'page', pageId: 'a' } }],
        },
      ],
    }
    const messages = lintSurvey(bad, { identifyContacts: true }).map(i => i.message)
    expect(messages.some(m => m.includes('jumps backwards'))).toBe(true)
    expect(messages.some(m => m.includes('question that no longer exists'))).toBe(true)
    expect(messages.some(m => m.includes('contact field that no longer exists'))).toBe(true)
    expect(messages.some(m => m.includes('no Email question'))).toBe(true)
  })
})
