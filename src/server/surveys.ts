import { db } from './db'
import type { Survey, SurveyDesign, SurveyResponse, SurveySettings } from '../features/survey-builder/types'
import { DEFAULT_SURVEY_SETTINGS, DEFAULT_SURVEY_THEME, isQuestionType } from '../features/survey-builder/types'
import { headlineSummary } from '../features/survey-builder/analytics'
import { surveyDesignSchema, surveySettingsSchema } from '../features/survey-builder/schema'
import { checkStructureLock } from '../features/survey-builder/applyAction'
import { lintSurvey } from '../features/survey-builder/logic/lint'
import { SURVEY_STARTER_TEMPLATES } from '../features/survey-builder/templates/starters'

/**
 * Survey operations shared by the server functions and the copilot tools, so
 * both enforce the same rules (validation, structure lock, publish lint).
 */

export function listSurveys() {
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString()
  // Every survey's responses from one pass over them, not one scan per survey.
  const bySurvey = db.getSurveyResponsesBySurvey()
  return db.getSurveys().map(s => {
    const responses = bySurvey.get(s.id) ?? []
    const completed = responses.filter(r => r.status === 'completed')
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      created_at: s.created_at,
      updated_at: s.updated_at,
      published_at: s.published_at,
      pageCount: s.design.pages.length,
      questionCount: s.design.pages.reduce((n, p) => n + p.blocks.filter(b => isQuestionType(b.type)).length, 0),
      responseCount: responses.length,
      completedCount: completed.length,
      responsesThisWeek: responses.filter(r => r.started_at >= weekAgo).length,
      lastResponseAt: responses.reduce<string | null>((latest, r) => (!latest || r.updated_at > latest ? r.updated_at : latest), null),
      headline: headlineResult(s, responses),
    }
  })
}

/**
 * The one number a survey's results lead with, for the list (`pickHeadline`):
 * its NPS, or the average of its first rating or scale question, taking the
 * first that has answers, as the results page does. Only those questions are
 * summarised. Null when it has neither, or nobody has answered yet.
 */
function headlineResult(survey: Survey, responses: SurveyResponse[]): { kind: 'nps' | 'rating' | 'scale'; value: number; max?: number } | null {
  if (!responses.length) return null
  const q = headlineSummary(survey.design, responses)
  if (q?.kind === 'nps' && q.score !== null) return { kind: 'nps', value: q.score }
  if (q?.kind === 'scale' && q.average !== null) {
    return { kind: q.type === 'rating' ? 'rating' : 'scale', value: Math.round(q.average * 10) / 10, max: q.min + q.distribution.length - 1 }
  }
  return null
}

export function getSurveyOrThrow(id: string): Survey {
  const survey = db.getSurvey(id)
  if (!survey) throw new Error('Survey not found')
  return survey
}

export function createSurvey(input: { name: string; templateId?: string; design?: SurveyDesign; settings?: Partial<SurveySettings> }): Survey {
  let design: SurveyDesign
  if (input.design) {
    design = surveyDesignSchema.parse(input.design)
  } else {
    const template = SURVEY_STARTER_TEMPLATES.find(t => t.id === (input.templateId ?? 'blank'))
    if (!template) throw new Error(`Unknown template "${input.templateId}"`)
    design = { pages: template.build(), theme: { ...DEFAULT_SURVEY_THEME, ...template.theme } }
  }
  const settings = surveySettingsSchema.parse({ ...DEFAULT_SURVEY_SETTINGS, ...input.settings })
  return db.addSurvey({ name: input.name.trim() || 'Untitled survey', design, settings })
}

export function updateSurvey(
  id: string,
  patch: { name?: string; design?: SurveyDesign; settings?: Partial<SurveySettings> },
): Survey {
  const survey = getSurveyOrThrow(id)
  const next: Partial<Survey> = {}
  if (patch.name !== undefined) next.name = patch.name.trim() || survey.name
  if (patch.design) {
    const design = surveyDesignSchema.parse(patch.design)
    if (db.getSurveyResponseCount(id) > 0) {
      const violation = checkStructureLock(survey.design, design)
      if (violation) throw new Error(violation)
    }
    next.design = design
  }
  if (patch.settings) next.settings = surveySettingsSchema.parse({ ...survey.settings, ...patch.settings })
  // A live survey's changes reach respondents as soon as they're saved, so they get the checks publishing does.
  // Only problems this change brings are refused, so a survey can still be closed or renamed while it has an older one.
  if (survey.status === 'published' && (next.design || next.settings)) {
    const fields = db.getContactFields()
    const before = new Set(lintErrors(survey.design, survey.settings, fields))
    const added = lintErrors(next.design ?? survey.design, next.settings ?? survey.settings, fields).filter(m => !before.has(m))
    if (added.length) throw new Error(`Fix these before publishing the changes:\n- ${added.join('\n- ')}`)
  }
  return db.updateSurvey(id, next)!
}

const lintErrors = (design: SurveyDesign, settings: SurveySettings, fields: ReturnType<typeof db.getContactFields>) =>
  lintSurvey(design, settings, fields)
    .filter(i => i.level === 'error')
    .map(i => i.message)

export function publishSurvey(id: string): Survey {
  const survey = getSurveyOrThrow(id)
  const errors = lintSurvey(survey.design, survey.settings, db.getContactFields()).filter(i => i.level === 'error')
  if (errors.length) throw new Error(`Fix these before publishing:\n- ${errors.map(e => e.message).join('\n- ')}`)
  return db.updateSurvey(id, { status: 'published', published_at: survey.published_at ?? new Date().toISOString() })!
}

export function closeSurvey(id: string): Survey {
  getSurveyOrThrow(id)
  return db.updateSurvey(id, { status: 'closed' })!
}

export function duplicateSurvey(id: string): Survey {
  const survey = getSurveyOrThrow(id)
  return db.addSurvey({
    name: `${survey.name} (copy)`,
    design: structuredClone(survey.design),
    settings: structuredClone(survey.settings),
  })
}

export function deleteSurvey(id: string) {
  getSurveyOrThrow(id)
  db.deleteSurvey(id)
}

/** Whether the survey accepts responses right now. */
export function isSurveyOpen(survey: Survey): boolean {
  if (survey.status !== 'published') return false
  if (survey.settings.closesAt && Date.parse(survey.settings.closesAt) < Date.now()) return false
  return true
}
