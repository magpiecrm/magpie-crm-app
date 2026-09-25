import { z } from 'zod'
import { defineTool } from '../types'
import { listRef, resolveListId } from './shared'

const settingsInput = z
  .object({
    identifyContacts: z.boolean().optional(),
    list: listRef.nullable().optional().describe('List new identified respondents are added to (by id or name). null = only update existing contacts.'),
    allowMultipleResponses: z.boolean().optional(),
    allowBack: z.boolean().optional(),
    closesAt: z.string().nullable().optional().describe('ISO date-time after which the survey stops accepting responses.'),
    thankYou: z.object({ title: z.string(), message: z.string(), redirectUrl: z.string().optional() }).optional(),
    notifyOnResponse: z.boolean().optional(),
  })
  .describe('Survey settings. Only the keys you pass change.')

async function toSettingsPatch(settings: z.infer<typeof settingsInput>) {
  const { list, ...rest } = settings
  return {
    ...rest,
    ...(list === undefined ? {} : { listId: list === null ? null : await resolveListId(list) }),
  }
}

export const surveyTools = [
  defineTool({
    name: 'getSurveys',
    description: 'List every survey with its status (draft/published/closed), response and completion counts.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { listSurveys } = await import('../../surveys')
      return listSurveys()
    },
  }),

  defineTool({
    name: 'getSurvey',
    description:
      'Read one survey in full: pages, questions, logic, theme and settings. If the survey builder is open on this survey, this is the last SAVED version — call getSurveyDesign for what is on screen.',
    input: { id: z.string() },
    target: 'server',
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const { getSurveyOrThrow } = await import('../../surveys')
      const { db } = await import('../../db')
      const survey = { ...getSurveyOrThrow(id), responseCount: db.getSurveyResponseCount(id) }
      const state = ctx.getClientState()
      if (state.surveyBuilder?.surveyId === id) {
        return {
          warning:
            'This survey is open in the survey builder, possibly with unsaved changes. The design below is only the last SAVED version. Call getSurveyDesign before describing or editing it.',
          ...survey,
        }
      }
      return survey
    },
  }),

  defineTool({
    name: 'createSurvey',
    description:
      'Create a draft survey, optionally from a starter template (call listSurveyTemplates). Returns its id. Build or edit the questions with updateSurvey, or ask the user to open it in the survey builder.',
    input: {
      name: z.string().min(1),
      templateId: z.string().optional().describe('Starter template id. Defaults to a blank survey.'),
      settings: settingsInput.optional(),
    },
    target: 'server',
    handler: async ({ name, templateId, settings }) => {
      const { createSurvey } = await import('../../surveys')
      const survey = createSurvey({ name, templateId, settings: settings ? await toSettingsPatch(settings) : undefined })
      return { id: survey.id, name: survey.name, status: survey.status, editUrl: `/marketing/surveys/${survey.id}/edit` }
    },
  }),

  defineTool({
    name: 'updateSurvey',
    description:
      "Change a survey's name, settings, or whole design ({pages, theme}, as returned by getSurvey). Prefer the survey builder tools when the builder is open. Once a survey has responses, questions and options can't be deleted or change type.",
    input: {
      id: z.string(),
      name: z.string().optional(),
      design: z.looseObject({ pages: z.array(z.any()), theme: z.looseObject({}) }).optional(),
      settings: settingsInput.optional(),
    },
    target: 'server',
    handler: async ({ id, name, design, settings }, ctx) => {
      // The builder holds edits in memory until the user saves; a design
      // written here would be silently overwritten by that save.
      const state = ctx.getClientState()
      if (design && state.surveyBuilder?.surveyId === id) {
        throw new Error(
          'The survey builder is open for this survey, so writing its design directly would be discarded the next time the user saves. Use the survey builder tools (addSurveyBlock, updateSurveyBlock, setSurveyPageLogic, …) instead.',
        )
      }
      const { updateSurvey } = await import('../../surveys')
      const saved = updateSurvey(id, { name, design: design as any, settings: settings ? await toSettingsPatch(settings) : undefined })
      return { id: saved.id, name: saved.name, status: saved.status }
    },
  }),

  defineTool({
    name: 'publishSurvey',
    description: 'Publish a survey so its link, embed and email blocks accept responses. Fails with a list of problems if the logic or questions are broken.',
    input: { id: z.string() },
    target: 'server',
    handler: async ({ id }) => {
      const { publishSurvey } = await import('../../surveys')
      const { getAppUrl } = await import('../../appUrl')
      const survey = publishSurvey(id)
      return { id, status: survey.status, link: `${await getAppUrl()}/s/${id}` }
    },
  }),

  defineTool({
    name: 'closeSurvey',
    description: 'Close a survey so it stops accepting responses. Existing responses are kept.',
    input: { id: z.string() },
    target: 'server',
    handler: async ({ id }) => {
      const { closeSurvey } = await import('../../surveys')
      return { id, status: closeSurvey(id).status }
    },
  }),

  defineTool({
    name: 'duplicateSurvey',
    description: 'Copy a survey as a new draft with no responses — the way to make structural changes to a survey that already has responses.',
    input: { id: z.string() },
    target: 'server',
    handler: async ({ id }) => {
      const { duplicateSurvey } = await import('../../surveys')
      const copy = duplicateSurvey(id)
      return { id: copy.id, name: copy.name }
    },
  }),

  defineTool({
    name: 'deleteSurvey',
    description: 'Permanently delete a survey and all of its responses.',
    input: { id: z.string() },
    target: 'server',
    destructive: true,
    handler: async ({ id }) => {
      const { deleteSurvey } = await import('../../surveys')
      deleteSurvey(id)
      return { deleted: id }
    },
  }),

  defineTool({
    name: 'getSurveyResults',
    description: 'Aggregated results: started/completed counts, completion rate, page drop-off, and per-question summaries (NPS score, averages, option counts, recent text answers).',
    input: { id: z.string() },
    target: 'server',
    readOnly: true,
    handler: async ({ id }) => {
      const { getSurveyOrThrow } = await import('../../surveys')
      const { db } = await import('../../db')
      const { computeSurveySummary } = await import('../../../features/survey-builder/analytics')
      const survey = getSurveyOrThrow(id)
      return computeSurveySummary(survey.design, db.getSurveyResponses(id))
    },
  }),

  defineTool({
    name: 'getSurveyResponses',
    description: 'Individual responses with answers as readable text, newest first. Filter by status or by respondent email.',
    input: {
      id: z.string(),
      status: z.enum(['partial', 'completed']).optional(),
      email: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Defaults to 50.'),
      offset: z.number().int().min(0).optional(),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ id, status, email, limit, offset }) => {
      const { getSurveyOrThrow } = await import('../../surveys')
      const { db } = await import('../../db')
      const { questionBlocks } = await import('../../../features/survey-builder/logic/evaluate')
      const { answerToDisplay } = await import('../../../features/survey-builder/logic/answers')
      const survey = getSurveyOrThrow(id)
      const questions = questionBlocks(survey.design).map(q => q.block)
      const all = db.getSurveyResponses(id, { status }).filter(r => !email || r.contact_email === email.toLowerCase().trim())
      const start = offset ?? 0
      return {
        total: all.length,
        responses: all.slice(start, start + (limit ?? 50)).map(r => ({
          id: r.id,
          email: r.contact_email,
          status: r.status,
          source: r.source,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          answers: Object.fromEntries(questions.filter(q => r.answers[q.id] !== undefined).map(q => [q.question?.title ?? q.id, answerToDisplay(q, r.answers[q.id])])),
        })),
      }
    },
  }),

  defineTool({
    name: 'getSurveyLinks',
    description: 'The public link, QR code link, website embed code, and the signed-in embed recipe (personal links for users of the customer\'s own app) for a survey. For email, add a `survey` block to the campaign design instead — that gives each recipient a personal link.',
    input: { id: z.string() },
    target: 'server',
    readOnly: true,
    handler: async ({ id }) => {
      const { getSurveyOrThrow } = await import('../../surveys')
      const { getAppUrl } = await import('../../appUrl')
      const { surveyEmbedSnippet, surveySignedEmbedExample } = await import('../../../features/surveys/embed')
      const survey = getSurveyOrThrow(id)
      const origin = await getAppUrl()
      return {
        status: survey.status,
        link: `${origin}/s/${id}`,
        qrLink: `${origin}/s/${id}?src=qr`,
        qrNote: 'The Share tab on the survey page shows this as a downloadable QR code (PNG/SVG). Scans are counted as source "QR code".',
        embed: surveyEmbedSnippet(origin, id),
        signedInEmbed: {
          note: 'For surveys inside the user\'s own app: their server exchanges an API key + the signed-in user\'s email for a personal iframe URL, so answers go to that contact without an Email question.',
          serverCode: surveySignedEmbedExample(origin, id),
        },
      }
    },
  }),

  defineTool({
    name: 'getContactFields',
    description: 'List custom contact fields (key, label, type, options). Survey questions can save answers to these via question.mapTo = { field: "custom:<key>", overwrite }.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { db } = await import('../../db')
      return db.getContactFields()
    },
  }),

  defineTool({
    name: 'createContactField',
    description: 'Create a custom contact field, e.g. to store an NPS score or industry answer on every respondent. Key is an immutable slug like "nps_score".',
    input: {
      key: z.string(),
      label: z.string().min(1),
      type: z.enum(['text', 'number', 'date', 'boolean', 'select', 'multiselect']),
      options: z.array(z.string()).optional().describe('Allowed values for select/multiselect.'),
    },
    target: 'server',
    handler: async args => {
      const { db } = await import('../../db')
      const { validateFieldKey } = await import('../../../features/contacts/contactFields')
      const error = validateFieldKey(args.key)
      if (error) throw new Error(error)
      return db.addContactField(args)
    },
  }),
]
