import { db } from './db'
import type { Survey, SurveyDesign, SurveySettings } from '../features/survey-builder/types'
import { DEFAULT_SURVEY_SETTINGS, DEFAULT_SURVEY_THEME } from '../features/survey-builder/types'
import { surveyDesignSchema, surveySettingsSchema } from '../features/survey-builder/schema'
import { checkStructureLock } from '../features/survey-builder/applyAction'
import { lintSurvey } from '../features/survey-builder/logic/lint'
import { SURVEY_STARTER_TEMPLATES } from '../features/survey-builder/templates/starters'

/**
 * Survey operations shared by the server functions and the copilot tools, so
 * both enforce the same rules (validation, structure lock, publish lint).
 */

export function listSurveys() {
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
      responseCount: responses.length,
      completedCount: completed.length,
      lastResponseAt: responses[0]?.updated_at ?? null,
    }
  })
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
