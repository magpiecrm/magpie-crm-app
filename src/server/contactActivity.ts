import { db } from './db'
import { findQuestion } from '../features/survey-builder/logic/evaluate'
import { answerToDisplay } from '../features/survey-builder/logic/answers'
import { isQuestionType } from '../features/survey-builder/types'

export interface ContactActivity {
  type:
    | 'campaign_sent'
    | 'campaign_opened'
    | 'campaign_clicked'
    | 'sequence_sent'
    | 'sequence_opened'
    | 'sequence_clicked'
    | 'sequence_replied'
    | 'form_submitted'
    | 'survey_started'
    | 'survey_completed'
  at: string
  label: string
  /** In-app link to the related record. */
  url?: string
}

/** A contact's survey responses with answers already formatted for display. */
export function contactSurveyResponses(email: string) {
  return db.getSurveyResponsesForContact(email).map(r => {
    const survey = db.getSurvey(r.survey_id)
    const answers = survey
      ? survey.design.pages
          .flatMap(p => p.blocks.filter(b => isQuestionType(b.type)))
          .filter(b => r.answers[b.id] !== undefined)
          .map(b => ({ question: b.question?.title ?? '', answer: answerToDisplay(findQuestion(survey.design, b.id), r.answers[b.id]) }))
      : []
    return {
      id: r.id,
      surveyId: r.survey_id,
      surveyName: survey?.name ?? 'Deleted survey',
      status: r.status,
      source: r.source,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      answers,
    }
  })
}

/**
 * The contact's timeline, derived on read from campaign recipients, form
 * submissions and survey responses — so there is no separate log to keep in
 * sync with them.
 */
export function contactActivity(email: string): ContactActivity[] {
  const normalized = email.toLowerCase().trim()
  const events: ContactActivity[] = []

  for (const r of db.data.campaign_recipients.filter(cr => cr.contact_email === normalized)) {
    const campaign = db.data.campaigns.find(c => c.id === r.campaign_id)
    // A sequence email: shown as the sequence's, at when it went to them.
    if (campaign?.sequence_id) {
      const sequence = db.data.sequences?.find(s => s.id === campaign.sequence_id)
      const step = sequence ? sequence.steps.findIndex(st => st.id === campaign.step_id) + 1 : 0
      const name = `${sequence?.name ?? 'Deleted sequence'}${step ? `, email ${step}` : ''}`
      const url = sequence ? `/sales/sequences/${sequence.id}` : undefined
      if (r.sent_at) events.push({ type: 'sequence_sent', at: r.sent_at, label: `Sent "${name}"`, url })
      if (r.opened_at) events.push({ type: 'sequence_opened', at: r.opened_at, label: `Opened "${name}"`, url })
      if (r.clicked_at) events.push({ type: 'sequence_clicked', at: r.clicked_at, label: `Clicked a link in "${name}"`, url })
      if (r.replied_at) events.push({ type: 'sequence_replied', at: r.replied_at, label: `Replied to "${name}"`, url })
      continue
    }
    const name = campaign?.name ?? `Campaign #${r.campaign_id}`
    const url = `/marketing/campaigns/${r.campaign_id}`
    if (campaign?.sent_at) events.push({ type: 'campaign_sent', at: campaign.sent_at, label: `Sent "${name}"`, url })
    if (r.opened_at) events.push({ type: 'campaign_opened', at: r.opened_at, label: `Opened "${name}"`, url })
    if (r.clicked_at) events.push({ type: 'campaign_clicked', at: r.clicked_at, label: `Clicked a link in "${name}"`, url })
  }

  for (const s of (db.data.form_submissions ?? []).filter(f => f.contact_email.toLowerCase() === normalized)) {
    const form = db.getForm(s.form_id)
    events.push({ type: 'form_submitted', at: s.submitted_at, label: `Submitted form "${form?.name ?? 'Deleted form'}"`, url: `/marketing/forms/${s.form_id}` })
  }

  for (const r of db.getSurveyResponsesForContact(normalized)) {
    const name = db.getSurvey(r.survey_id)?.name ?? 'Deleted survey'
    const url = `/marketing/surveys/${r.survey_id}`
    events.push({ type: 'survey_started', at: r.started_at, label: `Started survey "${name}"`, url })
    if (r.completed_at) events.push({ type: 'survey_completed', at: r.completed_at, label: `Completed survey "${name}"`, url })
  }

  return events.sort((a, b) => b.at.localeCompare(a.at))
}
