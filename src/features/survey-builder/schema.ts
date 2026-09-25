import { z } from 'zod'
import type { Condition, SurveyDesign, SurveySettings } from './types'
import { QUESTION_TYPES } from './types'

/**
 * Runtime validation for designs and settings arriving from the browser or the
 * copilot. Shapes match `types.ts`; unknown keys are stripped.
 */

const blockType = z.enum(['heading', 'text', 'image', 'divider', 'spacer', 'html', ...QUESTION_TYPES])

const questionSchema = z.object({
  title: z.string().max(500),
  description: z.string().max(2000).optional(),
  required: z.boolean(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.object({ id: z.string().min(1), label: z.string().max(300) })).max(100).optional(),
  allowOther: z.boolean().optional(),
  randomizeOptions: z.boolean().optional(),
  minSelect: z.number().int().min(0).optional(),
  maxSelect: z.number().int().min(0).optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  scale: z
    .object({
      min: z.number().int(),
      max: z.number().int(),
      minLabel: z.string().max(100).optional(),
      maxLabel: z.string().max(100).optional(),
      icon: z.enum(['star', 'heart', 'number']).optional(),
    })
    .optional(),
  mapTo: z
    .object({
      field: z.union([z.enum(['first_name', 'last_name', 'job_title', 'company']), z.templateLiteral(['custom:', z.string()])]),
      overwrite: z.enum(['always', 'if_empty']),
    })
    .optional(),
})

const blockSchema = z.object({
  id: z.string().min(1),
  type: blockType,
  content: z.string().max(50_000).optional(),
  alt: z.string().max(500).optional(),
  url: z.string().max(2000).optional(),
  width: z.string().max(10).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  style: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  question: questionSchema.optional(),
})

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      questionId: z.string(),
      op: z.enum(['answered', 'not_answered', 'eq', 'neq', 'includes', 'not_includes', 'gt', 'gte', 'lt', 'lte']),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    }),
    z.object({ all: z.array(conditionSchema) }),
    z.object({ any: z.array(conditionSchema) }),
  ]),
)

const pageTarget = z.union([
  z.object({ kind: z.literal('next') }),
  z.object({ kind: z.literal('page'), pageId: z.string() }),
  z.object({ kind: z.literal('end') }),
])

const pageSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200).optional(),
  blocks: z.array(blockSchema).max(200),
  rules: z.array(z.object({ id: z.string(), when: conditionSchema, goTo: pageTarget })).max(50).optional(),
  defaultNext: pageTarget.optional(),
})

const themeSchema = z.object({
  bodyWidth: z.number().min(280).max(1200),
  pageBgColor: z.string(),
  cardBgColor: z.string(),
  textColor: z.string(),
  accentColor: z.string(),
  buttonTextColor: z.string(),
  buttonRadius: z.number().min(0).max(100),
  fontFamily: z.string(),
  lineHeight: z.number().min(1).max(3),
  cardMode: z.boolean().optional(),
  cardRadius: z.number().min(0).max(100).optional(),
  bgImage: z.string().optional(),
  logoUrl: z.string().optional(),
  showProgressBar: z.boolean(),
  nextLabel: z.string().max(40),
  backLabel: z.string().max(40),
  submitLabel: z.string().max(40),
})

export const surveyDesignSchema = z.object({
  pages: z.array(pageSchema).min(1).max(50),
  theme: themeSchema,
}) as unknown as z.ZodType<SurveyDesign>

export const surveySettingsSchema = z.object({
  identifyContacts: z.boolean(),
  listId: z.number().int().nullable(),
  allowMultipleResponses: z.boolean(),
  allowBack: z.boolean(),
  closesAt: z.string().nullable().optional(),
  thankYou: z.object({
    title: z.string().max(200),
    message: z.string().max(2000),
    redirectUrl: z.string().max(2000).optional(),
  }),
  notifyOnResponse: z.boolean(),
}) as unknown as z.ZodType<SurveySettings>
