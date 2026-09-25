import { describe, expect, it } from 'vitest'
import type { SurveyDesign } from './types'
import { DEFAULT_SURVEY_THEME } from './types'
import { applySurveyBuilderAction, checkStructureLock } from './applyAction'
import { SURVEY_STARTER_TEMPLATES } from './templates/starters'
import { lintSurvey } from './logic/lint'

const base = (): SurveyDesign => ({
  theme: DEFAULT_SURVEY_THEME,
  pages: [
    {
      id: 'p1',
      blocks: [
        { id: 'q1', type: 'single_choice', question: { title: 'Pick', required: true, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } },
      ],
      rules: [{ id: 'r1', when: { questionId: 'q1', op: 'eq', value: 'a' }, goTo: { kind: 'page', pageId: 'p2' } }],
    },
    { id: 'p2', blocks: [{ id: 'q2', type: 'short_text', question: { title: 'Why', required: false } }] },
  ],
})

describe('applySurveyBuilderAction', () => {
  it('accepts both namespaced and bare action names', () => {
    const d1 = applySurveyBuilderAction(base(), { action: 'survey.setTheme', args: { updates: { accentColor: '#f00' } } })
    const d2 = applySurveyBuilderAction(base(), { action: 'setTheme', args: { updates: { accentColor: '#f00' } } })
    expect(d1.theme.accentColor).toBe('#f00')
    expect(d2).toEqual(d1)
  })

  it('adds blocks with a normalised question', () => {
    const d = applySurveyBuilderAction(base(), { action: 'survey.addBlock', args: { pageId: 'p2', index: 0, block: { type: 'nps' } } })
    expect(d.pages[1].blocks[0]).toMatchObject({ type: 'nps', question: { title: '', required: false } })
    expect(d.pages[1].blocks[0].id).toBeTruthy()
  })

  it('merges question updates rather than replacing them', () => {
    const d = applySurveyBuilderAction(base(), { action: 'survey.updateBlock', args: { id: 'q1', updates: { question: { title: 'New' } } } })
    expect(d.pages[0].blocks[0].question).toMatchObject({ title: 'New', required: true })
    expect(d.pages[0].blocks[0].question?.options).toHaveLength(2)
  })

  it('prunes rules when their question or target page is deleted', () => {
    expect(applySurveyBuilderAction(base(), { action: 'survey.deleteBlock', args: { id: 'q1' } }).pages[0].rules).toEqual([])
    expect(applySurveyBuilderAction(base(), { action: 'survey.deletePage', args: { id: 'p2' } }).pages[0].rules).toEqual([])
  })

  it('never deletes the last page', () => {
    const one = applySurveyBuilderAction(base(), { action: 'survey.deletePage', args: { id: 'p2' } })
    expect(applySurveyBuilderAction(one, { action: 'survey.deletePage', args: { id: 'p1' } }).pages).toHaveLength(1)
  })

  it('moves blocks across pages', () => {
    const d = applySurveyBuilderAction(base(), { action: 'survey.moveBlock', args: { id: 'q2', toPageId: 'p1', index: 0 } })
    expect(d.pages[0].blocks.map(b => b.id)).toEqual(['q2', 'q1'])
    expect(d.pages[1].blocks).toEqual([])
  })

  it('edits options row by row', () => {
    let d = applySurveyBuilderAction(base(), { action: 'survey.addOption', args: { blockId: 'q1', option: { label: 'C' } } })
    d = applySurveyBuilderAction(d, { action: 'survey.updateOption', args: { blockId: 'q1', optionId: 'a', updates: { label: 'Alpha' } } })
    d = applySurveyBuilderAction(d, { action: 'survey.moveOption', args: { blockId: 'q1', optionId: 'b', direction: 'up' } })
    expect(d.pages[0].blocks[0].question?.options?.map(o => o.label)).toEqual(['B', 'Alpha', 'C'])
  })
})

describe('checkStructureLock', () => {
  it('allows wording edits and new questions', () => {
    let d = applySurveyBuilderAction(base(), { action: 'survey.updateBlock', args: { id: 'q1', updates: { question: { title: 'Reworded' } } } })
    d = applySurveyBuilderAction(d, { action: 'survey.addBlock', args: { pageId: 'p1', block: { type: 'yes_no' } } })
    expect(checkStructureLock(base(), d)).toBeNull()
  })

  it('blocks deleting questions or options and changing types', () => {
    expect(checkStructureLock(base(), applySurveyBuilderAction(base(), { action: 'survey.deleteBlock', args: { id: 'q2' } }))).toMatch(/can't be deleted/)
    expect(checkStructureLock(base(), applySurveyBuilderAction(base(), { action: 'survey.deleteOption', args: { blockId: 'q1', optionId: 'b' } }))).toMatch(/Option "B"/)
    expect(checkStructureLock(base(), applySurveyBuilderAction(base(), { action: 'survey.updateBlock', args: { id: 'q2', updates: { type: 'long_text' } } }))).toMatch(/type/)
  })
})

describe('starter templates', () => {
  it('all lint without errors', () => {
    for (const t of SURVEY_STARTER_TEMPLATES) {
      const errors = lintSurvey({ theme: DEFAULT_SURVEY_THEME, pages: t.build() }).filter(i => i.level === 'error')
      // The blank template intentionally has no questions yet.
      if (t.id === 'blank') continue
      expect(errors, t.id).toEqual([])
    }
  })
})
