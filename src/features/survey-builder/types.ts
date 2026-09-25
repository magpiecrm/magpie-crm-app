/**
 * Survey block model.
 *
 * Mirrors `email-builder/types.ts`: one flat block shape shared by content and
 * question blocks, plus a page-level theme (the survey's `GlobalStyle`). The
 * difference is that a survey is split into pages, because skip logic needs
 * stable page ids to jump to.
 */

type SurveyContentType = 'heading' | 'text' | 'image' | 'divider' | 'spacer' | 'html'

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'number'
  | 'date'
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'rating'
  | 'nps'
  | 'scale'
  | 'yes_no'

export type SurveyBlockType = SurveyContentType | QuestionType

/** A choice option. The id is stable so answers survive label edits. */
export interface ChoiceOption {
  id: string
  label: string
}

/** Built-in contact columns an answer can be written to. */
export const BUILTIN_CONTACT_FIELDS = ['first_name', 'last_name', 'job_title', 'company'] as const
type BuiltinContactField = (typeof BUILTIN_CONTACT_FIELDS)[number]

export interface ContactFieldMapping {
  /** A built-in column, or `custom:<key>` for a custom contact field. */
  field: BuiltinContactField | `custom:${string}`
  /** `if_empty` never clobbers data the contact already has. */
  overwrite: 'always' | 'if_empty'
}

export interface QuestionScale {
  min: number
  max: number
  minLabel?: string
  maxLabel?: string
  icon?: 'star' | 'heart' | 'number'
}

export interface QuestionConfig {
  title: string
  description?: string
  required: boolean
  placeholder?: string
  /** single_choice / multiple_choice / dropdown. */
  options?: ChoiceOption[]
  /** Adds a free-text "Other" option to choice questions. */
  allowOther?: boolean
  randomizeOptions?: boolean
  minSelect?: number
  maxSelect?: number
  /** Text length bounds. */
  minLength?: number
  maxLength?: number
  /** Number / date bounds (dates as YYYY-MM-DD strings are compared lexically). */
  min?: number
  max?: number
  step?: number
  /** rating / scale. NPS is always 0–10. */
  scale?: QuestionScale
  /** Write the answer back to the respondent's contact record. */
  mapTo?: ContactFieldMapping
}

/** Subset of `EmailBlockStyle`, same key names so shared controls work on both. */
interface SurveyBlockStyle {
  color?: string
  bgColor?: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'
  padding?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  borderRadius?: number
  height?: number
}

export interface SurveyBlock {
  id: string
  type: SurveyBlockType
  /** heading/text copy, image URL, raw html, spacer height. */
  content?: string
  alt?: string
  url?: string
  width?: string
  align?: 'left' | 'center' | 'right'
  style?: SurveyBlockStyle
  /** Present iff `isQuestionType(type)`. */
  question?: QuestionConfig
}

export type PageTarget = { kind: 'next' } | { kind: 'page'; pageId: string } | { kind: 'end' }

export type ConditionOp =
  | 'answered'
  | 'not_answered'
  | 'eq'
  | 'neq'
  | 'includes'
  | 'not_includes'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export type Condition =
  | { questionId: string; op: ConditionOp; value?: string | number | boolean }
  | { all: Condition[] }
  | { any: Condition[] }

export interface LogicRule {
  id: string
  when: Condition
  goTo: PageTarget
}

export interface SurveyPage {
  id: string
  title?: string
  blocks: SurveyBlock[]
  /** Evaluated in order after the page is submitted; the first match wins. */
  rules?: LogicRule[]
  /** Used when no rule matches. Undefined means the next page. */
  defaultNext?: PageTarget
}

/** The survey's `GlobalStyle`. */
export interface SurveyTheme {
  bodyWidth: number
  pageBgColor: string
  cardBgColor: string
  textColor: string
  accentColor: string
  buttonTextColor: string
  buttonRadius: number
  fontFamily: string
  lineHeight: number
  cardMode?: boolean
  cardRadius?: number
  bgImage?: string
  logoUrl?: string
  showProgressBar: boolean
  nextLabel: string
  backLabel: string
  submitLabel: string
}

export interface SurveyDesign {
  pages: SurveyPage[]
  theme: SurveyTheme
}

export interface SurveySettings {
  /** Tie anonymous responses to a contact via the survey's `email` question. */
  identifyContacts: boolean
  /** When set, identified respondents who aren't contacts yet are created and added here. */
  listId: number | null
  allowMultipleResponses: boolean
  allowBack: boolean
  closesAt?: string | null
  thankYou: { title: string; message: string; redirectUrl?: string }
  notifyOnResponse: boolean
}

export type SurveyStatus = 'draft' | 'published' | 'closed'

export interface Survey {
  id: string
  name: string
  status: SurveyStatus
  design: SurveyDesign
  settings: SurveySettings
  created_at: string
  updated_at: string
  published_at: string | null
}

export type ChoiceAnswer = { optionIds: string[]; other?: string }
export type AnswerValue = string | number | boolean | ChoiceAnswer | null
export type Answers = Record<string, AnswerValue>

export type ResponseSource = 'email' | 'email_inline' | 'link' | 'embed' | 'qr'

export interface SurveyResponse {
  id: string
  survey_id: string
  contact_email: string | null
  source: ResponseSource
  campaign_id: number | null
  status: 'partial' | 'completed'
  /** Keyed by question block id. */
  answers: Answers
  /** Page ids visited, in order. */
  path: string[]
  current_page_id: string | null
  /** sha256 of the anonymous resume key; null for token-identified responses. */
  resume_key_hash: string | null
  started_at: string
  updated_at: string
  completed_at: string | null
  meta?: { test?: boolean; referrer?: string; embed_origin?: string }
}

export const QUESTION_TYPES: QuestionType[] = [
  'short_text',
  'long_text',
  'email',
  'number',
  'date',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'rating',
  'nps',
  'scale',
  'yes_no',
]

export function isQuestionType(type: string): type is QuestionType {
  return (QUESTION_TYPES as string[]).includes(type)
}

export const CHOICE_TYPES: QuestionType[] = ['single_choice', 'multiple_choice', 'dropdown']

/**
 * Question types that can be answered by clicking a link inside an email.
 * `single_choice` is limited to a handful of options so the email stays sane.
 */
export const EMAIL_EMBEDDABLE_TYPES: QuestionType[] = ['rating', 'nps', 'scale', 'yes_no', 'single_choice']
export const EMAIL_EMBED_MAX_OPTIONS = 6

export interface SurveyBlockTypeInfo {
  type: SurveyBlockType
  label: string
  /** Written for the copilot: what it is and when to reach for it. */
  description: string
  /** Fields beyond `id`/`type`/`style` that this block actually reads. */
  fields: string[]
  isQuestion: boolean
}

/**
 * Runtime catalogue, for the same reason as `BLOCK_TYPES` in the email
 * builder: the palette and the copilot prompt both read it, so a new type
 * cannot be added without being visible to both.
 */
const SURVEY_BLOCK_TYPE_INFO: Record<SurveyBlockType, Omit<SurveyBlockTypeInfo, 'type' | 'isQuestion'>> = {
  heading: { label: 'Heading', description: 'A heading line.', fields: ['content', 'align'] },
  text: { label: 'Text', description: 'A paragraph of copy, e.g. an intro or instructions.', fields: ['content', 'align'] },
  image: { label: 'Image', description: 'A single image. Always set alt.', fields: ['content (image URL)', 'url', 'alt', 'width', 'align'] },
  divider: { label: 'Divider', description: 'A horizontal rule.', fields: ['style.color'] },
  spacer: { label: 'Spacer', description: 'Vertical whitespace.', fields: ['style.height'] },
  html: { label: 'Raw HTML', description: 'Escape hatch for hand-written markup. Avoid unless asked.', fields: ['content (raw HTML)'] },
  short_text: { label: 'Short text', description: 'One-line free text answer.', fields: ['question.{title,description,required,placeholder,minLength,maxLength,mapTo}'] },
  long_text: { label: 'Long text', description: 'Multi-line free text answer, for open feedback.', fields: ['question.{title,description,required,placeholder,maxLength,mapTo}'] },
  email: { label: 'Email', description: 'Email address. Identifies anonymous respondents as contacts when the survey has identifyContacts on.', fields: ['question.{title,required,placeholder}'] },
  number: { label: 'Number', description: 'A numeric answer with optional min/max/step.', fields: ['question.{title,required,min,max,step,mapTo}'] },
  date: { label: 'Date', description: 'A calendar date (YYYY-MM-DD).', fields: ['question.{title,required,mapTo}'] },
  single_choice: { label: 'Single choice', description: 'Pick one option (radio buttons). Can be answered inline in an email with up to 6 options.', fields: ['question.{title,required,options[].{id,label},allowOther,randomizeOptions,mapTo}'] },
  multiple_choice: { label: 'Multiple choice', description: 'Pick any number of options (checkboxes).', fields: ['question.{title,required,options[].{id,label},allowOther,minSelect,maxSelect,mapTo}'] },
  dropdown: { label: 'Dropdown', description: 'Pick one option from a select menu. Good for long option lists.', fields: ['question.{title,required,options[].{id,label},mapTo}'] },
  rating: { label: 'Rating', description: 'Star/heart rating, default 1–5. Can be answered inline in an email.', fields: ['question.{title,required,scale.{min,max,icon},mapTo}'] },
  nps: { label: 'NPS', description: 'Net Promoter Score, 0–10 "how likely are you to recommend". Can be answered inline in an email.', fields: ['question.{title,required,scale.{minLabel,maxLabel},mapTo}'] },
  scale: { label: 'Scale', description: 'Numbered linear scale with end labels, e.g. 1–7 agreement. Can be answered inline in an email.', fields: ['question.{title,required,scale.{min,max,minLabel,maxLabel},mapTo}'] },
  yes_no: { label: 'Yes / No', description: 'A two-button yes/no answer. Can be answered inline in an email.', fields: ['question.{title,required,mapTo}'] },
}

/** Declaration order is the order the builder palette shows them in. */
export const SURVEY_BLOCK_TYPES: SurveyBlockTypeInfo[] = (Object.keys(SURVEY_BLOCK_TYPE_INFO) as SurveyBlockType[])
  .map(type => ({ type, isQuestion: isQuestionType(type), ...SURVEY_BLOCK_TYPE_INFO[type] }))

const SURVEY_THEME_INFO: Record<keyof SurveyTheme, string> = {
  bodyWidth: 'Max width of the survey card in px, e.g. 640.',
  pageBgColor: 'Background behind the survey card.',
  cardBgColor: 'Background of the survey card itself.',
  textColor: 'Base text colour.',
  accentColor: 'Buttons, selected options, progress bar.',
  buttonTextColor: 'Label colour on accent-coloured buttons.',
  buttonRadius: 'Corner radius of buttons and options in px.',
  fontFamily: 'Base font stack.',
  lineHeight: 'Base line height multiplier, e.g. 1.5.',
  cardMode: 'When true, each block renders as its own rounded card.',
  cardRadius: 'Corner radius of the survey card(s) in px.',
  bgImage: 'Background image URL behind the survey.',
  logoUrl: 'Logo shown above the survey.',
  showProgressBar: 'Show a progress bar across multi-page surveys.',
  nextLabel: 'Label of the "next page" button.',
  backLabel: 'Label of the "back" button.',
  submitLabel: 'Label of the final submit button.',
}

export const SURVEY_THEME_KEYS = (Object.keys(SURVEY_THEME_INFO) as Array<keyof SurveyTheme>)
  .map(key => ({ key, description: SURVEY_THEME_INFO[key] }))

export const DEFAULT_SURVEY_THEME: SurveyTheme = {
  bodyWidth: 640,
  pageBgColor: '#f4f4f5',
  cardBgColor: '#ffffff',
  textColor: '#18181b',
  accentColor: '#27272a',
  buttonTextColor: '#ffffff',
  buttonRadius: 8,
  fontFamily: 'Helvetica, Arial, sans-serif',
  lineHeight: 1.5,
  cardRadius: 12,
  showProgressBar: true,
  nextLabel: 'Next',
  backLabel: 'Back',
  submitLabel: 'Submit',
}

export const DEFAULT_SURVEY_SETTINGS: SurveySettings = {
  identifyContacts: true,
  listId: null,
  allowMultipleResponses: false,
  allowBack: true,
  closesAt: null,
  thankYou: { title: 'Thank you!', message: 'Your response has been recorded.' },
  notifyOnResponse: true,
}
