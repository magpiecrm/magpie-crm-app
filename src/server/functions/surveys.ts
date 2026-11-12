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

/** The summary of a survey's responses, optionally only the last `days` days' or one source's. */
export const getSurveySummaryFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string; days?: number; source?: string; answer?: { questionId: string; value: string } }) => ({
    id: String(d.id),
    days: typeof d.days === 'number' && d.days > 0 ? Math.min(d.days, 3650) : undefined,
    source: typeof d.source === 'string' && d.source ? d.source : undefined,
    answer: d.answer && typeof d.answer.questionId === 'string' && typeof d.answer.value === 'string' ? { questionId: d.answer.questionId, value: d.answer.value } : undefined,
  }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    const { getSurveyOrThrow } = await import('../surveys')
    const { computeSurveySummary } = await import('../../features/survey-builder/analytics')
    const { matchesAnswer } = await import('../../features/survey-builder/logic/answerFilter')
    const { findQuestion } = await import('../../features/survey-builder/logic/evaluate')
    await requireAuth()
    const survey = getSurveyOrThrow(data.id)
    const all = db.getSurveyResponses(survey.id)
    const since = data.days ? new Date(Date.now() - data.days * 86400e3).toISOString() : ''
    const by = data.answer ? findQuestion(survey.design, data.answer.questionId) : undefined
    const responses = all.filter(
      r => (!since || r.started_at >= since) && (!data.source || r.source === data.source) && (!by || matchesAnswer(by, r.answers[by.id], data.answer!.value)),
    )
    const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString()
    return {
      ...computeSurveySummary(survey.design, responses),
      total: all.length,
      thisWeek: responses.filter(r => r.started_at >= weekAgo).length,
      latestAt: responses.reduce<string | null>((latest, r) => (!latest || r.updated_at > latest ? r.updated_at : latest), null),
      /** Sources any response came from, for the filter. */
      sources: [...new Set(all.map(r => r.source))],
    }
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
      .map(r => {
        const contact = r.contact_email ? db.getContact(r.contact_email) : null
        const name = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : ''
        return { ...r, resume_key_hash: null, campaignName: r.campaign_id ? campaigns.get(r.campaign_id) ?? null : null, contactName: name || null, isContact: !!contact }
      })
  })

/** The team's tags and note on one response; neither is shown to the respondent. */
export const updateSurveyResponseNotesFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; tags?: string[]; note?: string }) => ({
    id: String(d.id),
    tags: Array.isArray(d.tags) ? [...new Set(d.tags.map(t => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : undefined,
    note: typeof d.note === 'string' ? d.note.slice(0, 4000) : undefined,
  }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const response = db.getSurveyResponse(data.id)
    if (!response) throw new Error('Response not found')
    if (data.tags !== undefined) response.tags = data.tags
    if (data.note !== undefined) response.note = data.note.trim() || undefined
    db.saveSurveyResponse(response)
    return { tags: response.tags ?? [], note: response.note ?? '' }
  })

export const deleteSurveyResponsesFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { surveyId: string; ids: string[] }) => ({ surveyId: String(d.surveyId), ids: Array.isArray(d.ids) ? d.ids.map(String).slice(0, 5000) : [] }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const ids = new Set(data.ids)
    // Only this survey's responses, whatever ids are sent.
    const mine = db.getSurveyResponses(data.surveyId, { includeTest: true }).filter(r => ids.has(r.id))
    db.deleteSurveyResponses(new Set(mine.map(r => r.id)))
    return { deleted: mine.length }
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
