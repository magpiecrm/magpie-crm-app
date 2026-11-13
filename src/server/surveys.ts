import { db } from './db'
import type { Survey, SurveyDesign, SurveyResponse, SurveySettings } from '../features/survey-builder/types'
import { DEFAULT_SURVEY_SETTINGS, DEFAULT_SURVEY_THEME, isQuestionType } from '../features/survey-builder/types'
import { computeSurveySummary } from '../features/survey-builder/analytics'
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
  return db.getSurveys().map(s => {
    const responses = db.getSurveyResponses(s.id)
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
 * The one number a survey's results lead with, for the list: its NPS, or the
 * average of its first rating or scale question. Null when it has neither, or
 * nobody has answered yet.
 */
function headlineResult(survey: Survey, responses: SurveyResponse[]): { kind: 'nps' | 'rating' | 'scale'; value: number; max?: number } | null {
  if (!responses.length) return null
  const questions = computeSurveySummary(survey.design, responses).questions
  const nps = questions.find(q => q.kind === 'nps')
  if (nps?.kind === 'nps' && nps.score !== null) return { kind: 'nps', value: nps.score }
  const scale = questions.find(q => q.kind === 'scale')
  if (scale?.kind === 'scale' && scale.average !== null) {
    return { kind: scale.type === 'rating' ? 'rating' : 'scale', value: Math.round(scale.average * 10) / 10, max: scale.min + scale.distribution.length - 1 }
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
  return db.updateSurvey(id, next)!
}

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
