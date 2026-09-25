import type { ChoiceOption, QuestionScale, QuestionType, SurveyDesign } from '../types'
import { EMAIL_EMBEDDABLE_TYPES, EMAIL_EMBED_MAX_OPTIONS, isQuestionType } from '../types'
import { scaleRange } from '../logic/validate'
import { escapeAttr, escapeHtml } from '../../email-builder/utils/html'

/**
 * What the email builder needs to render a survey's first question inline.
 * Stored on the email block so `compileHTML` stays pure and synchronous (it
 * runs on the canvas and in copilot previews with no database). Option ids
 * are stable, so links in already-sent emails keep working after edits.
 */
export interface SurveyEmailSnapshot {
  surveyName: string
  questionId: string
  type: QuestionType
  title: string
  options?: ChoiceOption[]
  scale?: QuestionScale
}

/** The snapshot for a survey's first question, or null if it can't be answered in an email. */
export function surveyEmailSnapshot(surveyName: string, design: SurveyDesign): SurveyEmailSnapshot | null {
  const first = design.pages[0]?.blocks.find(b => isQuestionType(b.type))
  if (!first?.question || !EMAIL_EMBEDDABLE_TYPES.includes(first.type as QuestionType)) return null
  if (first.type === 'single_choice' && (first.question.options?.length ?? 0) > EMAIL_EMBED_MAX_OPTIONS) return null
  return {
    surveyName,
    questionId: first.id,
    type: first.type as QuestionType,
    title: first.question.title,
    ...(first.question.options ? { options: first.question.options.map(o => ({ id: o.id, label: o.label })) } : {}),
    scale: { ...scaleRange(first), ...first.question.scale, ...(first.type === 'nps' ? { min: 0, max: 10 } : {}) },
  }
}

export const surveyLinkPlaceholder = (surveyId: string) => `{{ survey_link:${surveyId} }}`
const surveyAnswerPlaceholder = (surveyId: string, questionId: string, value: string | number | boolean) =>
  `{{ survey_answer:${surveyId}:${questionId}:${value} }}`

interface InlineStyle {
  accent: string
  accentText: string
  textColor: string
  font: string
  radius: number
}

/**
 * The first question as a row of links, one per answer. Plain table cells with
 * background colours rather than images, which render everywhere including
 * Outlook's Word engine.
 */
export function renderSurveyInlineHtml(surveyId: string, snap: SurveyEmailSnapshot, style: InlineStyle): string {
  const cell = (label: string, value: string | number | boolean, widthPct?: number) =>
    `<td align="center" ${widthPct ? `width="${widthPct}%"` : ''} style="padding: 2px;">
      <a href="${escapeAttr(surveyAnswerPlaceholder(surveyId, snap.questionId, value))}" target="_blank" style="display: block; padding: 10px 0; background-color: ${escapeAttr(style.accent)}; color: ${escapeAttr(style.accentText)}; font-family: ${escapeAttr(style.font)}; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: ${style.radius}px;">${label}</a>
    </td>`

  const row = (cells: string[]) =>
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse; table-layout: fixed;"><tbody><tr>${cells.join('')}</tr></tbody></table>`

  let body = ''
  const min = snap.scale?.min ?? 1
  const max = snap.scale?.max ?? 5
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i)

  switch (snap.type) {
    case 'nps':
    case 'scale':
      body = row(values.map(n => cell(String(n), n, Math.floor(100 / values.length))))
      if (snap.scale?.minLabel || snap.scale?.maxLabel) {
        body += `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%;"><tbody><tr>
          <td align="left" style="font-family: ${escapeAttr(style.font)}; font-size: 12px; color: ${escapeAttr(style.textColor)}; padding-top: 4px;">${escapeHtml(snap.scale?.minLabel ?? '')}</td>
          <td align="right" style="font-family: ${escapeAttr(style.font)}; font-size: 12px; color: ${escapeAttr(style.textColor)}; padding-top: 4px;">${escapeHtml(snap.scale?.maxLabel ?? '')}</td>
        </tr></tbody></table>`
      }
      break
    case 'rating': {
      const glyph = snap.scale?.icon === 'heart' ? '&#9829;' : snap.scale?.icon === 'number' ? '' : '&#9733;'
      body = row(values.map(n => cell(glyph ? `${n}&nbsp;${glyph}` : String(n), n, Math.floor(100 / values.length))))
      break
    }
    case 'yes_no':
      body = row([cell('Yes', true, 50), cell('No', false, 50)])
      break
    case 'single_choice':
      body = (snap.options ?? []).map(o => row([cell(escapeHtml(o.label), o.id)])).join('')
      break
  }

  return `<div style="font-family: ${escapeAttr(style.font)}; font-size: 17px; font-weight: bold; color: ${escapeAttr(style.textColor)}; padding-bottom: 12px;">${escapeHtml(snap.title)}</div>${body}`
}
