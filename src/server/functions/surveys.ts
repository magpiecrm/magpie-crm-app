import { createServerFn } from '@tanstack/react-start'
import type { SurveyDesign, SurveySettings } from '../../features/survey-builder/types'

export const getSurveysFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { listSurveys } = await import('../surveys')
  await requireAuth()
  return listSurveys()
})

export const getSurveyFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    const { getSurveyOrThrow } = await import('../surveys')
    await requireAuth()
    const survey = getSurveyOrThrow(data.id)
    // The builder needs to know whether structural edits are locked.
    return { ...survey, responseCount: db.getSurveyResponseCount(survey.id) }
  })

export const createSurveyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string; templateId?: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { createSurvey } = await import('../surveys')
    await requireAuth()
    return createSurvey(data)
  })

export const updateSurveyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; name?: string; design?: SurveyDesign; settings?: Partial<SurveySettings> }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { updateSurvey } = await import('../surveys')
    await requireAuth()
    const { id, ...patch } = data
    return updateSurvey(id, patch)
  })

export const publishSurveyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { publishSurvey } = await import('../surveys')
    await requireAuth()
    return publishSurvey(data.id)
  })

export const closeSurveyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { closeSurvey } = await import('../surveys')
    await requireAuth()
    return closeSurvey(data.id)
  })

export const duplicateSurveyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { duplicateSurvey } = await import('../surveys')
    await requireAuth()
    return duplicateSurvey(data.id)
  })

export const deleteSurveyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { deleteSurvey } = await import('../surveys')
    await requireAuth()
    deleteSurvey(data.id)
    return { success: true }
  })

/**
 * Public: loads a survey for the hosted page and embeds. Deliberately has no
 * requireAuth — respondents aren't logged in. It only returns the public
 * payload (no contact mappings or list ids). Previewing a draft does require
 * a session.
 */
export const getPublicSurveyFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string; t?: string; preview?: boolean }) => d)
  .handler(async ({ data }) => {
    const { loadPublicSurvey } = await import('../surveyResponses')
    let preview = false
    if (data.preview) {
      const { requireAuth } = await import('../auth.server')
      preview = await requireAuth().then(() => true, () => false)
    }
    return loadPublicSurvey(data.id, { t: data.t, preview })
  })

export const getSurveySummaryFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    const { getSurveyOrThrow } = await import('../surveys')
    const { computeSurveySummary } = await import('../../features/survey-builder/analytics')
    await requireAuth()
    const survey = getSurveyOrThrow(data.id)
    return computeSurveySummary(survey.design, db.getSurveyResponses(survey.id))
  })

export const getSurveyResponsesFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string; status?: 'partial' | 'completed'; source?: string; campaignId?: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const campaigns = new Map(db.data.campaigns.map(c => [c.id, c.name]))
    return db
      .getSurveyResponses(data.id, { status: data.status })
      .filter(r => !data.source || r.source === data.source)
      .filter(r => data.campaignId === undefined || r.campaign_id === data.campaignId)
      .map(r => ({ ...r, resume_key_hash: null, campaignName: r.campaign_id ? campaigns.get(r.campaign_id) ?? null : null }))
  })

export const deleteSurveyResponseFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.deleteSurveyResponse(data.id)
    return { success: true }
  })
