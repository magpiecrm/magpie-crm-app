import { describe, expect, it } from 'vitest'
import { compileHTML } from '../../email-builder/utils/compiler'
import type { GlobalStyle } from '../../email-builder/types'
import { DEFAULT_SURVEY_THEME } from '../types'
import { surveyEmailSnapshot } from './emailSnippet'

const globalStyle: GlobalStyle = {
  bodyWidth: 600,
  bodyBgColor: '#ffffff',
  canvasBgColor: '#ffffff',
  buttonBgColor: '#27272a',
  buttonTextColor: '#ffffff',
  buttonRadius: 4,
  fontFamily: 'Arial, sans-serif',
  paddingX: 20,
  paddingY: 20,
  lineHeight: 1.5,
}

describe('survey email block', () => {
  const snapshot = surveyEmailSnapshot('NPS', {
    theme: DEFAULT_SURVEY_THEME,
    pages: [{ id: 'p1', blocks: [{ id: 'q1', type: 'nps', question: { title: 'Recommend us?', required: true } }] }],
  })!

  it('snapshots the first embeddable question', () => {
    expect(snapshot).toMatchObject({ questionId: 'q1', type: 'nps', scale: { min: 0, max: 10 } })
    expect(
      surveyEmailSnapshot('Text', { theme: DEFAULT_SURVEY_THEME, pages: [{ id: 'p', blocks: [{ id: 'x', type: 'long_text', question: { title: '', required: false } }] }] }),
    ).toBeNull()
  })

  it('compiles inline mode to one answer link per score, plus the full-survey link', () => {
    const html = compileHTML(
      [{ id: 'b', type: 'survey', content: '', surveyId: 'abc-123', surveyMode: 'inline', surveySnapshot: snapshot }],
      globalStyle,
    )
    for (let n = 0; n <= 10; n++) expect(html).toContain(`{{ survey_answer:abc-123:q1:${n} }}`)
    expect(html).toContain('{{ survey_link:abc-123 }}')
  })

  it('compiles button mode, and nothing without a survey', () => {
    const button = compileHTML([{ id: 'b', type: 'survey', content: 'Go', surveyId: 'abc-123', surveyMode: 'button' }], globalStyle)
    expect(button).toContain('{{ survey_link:abc-123 }}')
    expect(button).not.toContain('survey_answer')
    const empty = compileHTML([{ id: 'b', type: 'survey', content: 'Go' }], globalStyle)
    expect(empty).not.toContain('survey_link')
  })
})
