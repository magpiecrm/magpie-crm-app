import type { QuestionConfig, SurveyBlock, SurveyBlockType, SurveyPage, SurveyTheme } from '../types'
import { newBlockId, newOptionId, newPageId } from '../applyAction'

export interface SurveyStarterTemplate {
  id: string
  name: string
  description: string
  category: 'Feedback' | 'Research' | 'Lead gen'
  /** Partial override merged onto the current theme when applied. */
  theme: Partial<SurveyTheme>
  /** Built fresh per call so ids are unique and never shared by reference. */
  build: () => SurveyPage[]
}

const heading = (content: string): SurveyBlock => ({ id: newBlockId(), type: 'heading', content })
const text = (content: string): SurveyBlock => ({ id: newBlockId(), type: 'text', content })

function q(type: SurveyBlockType, title: string, extra: Partial<QuestionConfig> = {}): SurveyBlock {
  return { id: newBlockId(), type, question: { title, required: false, ...extra } }
}

const options = (...labels: string[]) => labels.map(label => ({ id: newOptionId(), label }))

export const SURVEY_STARTER_TEMPLATES: SurveyStarterTemplate[] = [
  {
    id: 'blank',
    name: 'Blank survey',
    description: 'One empty page.',
    category: 'Feedback',
    theme: {},
    build: () => [{ id: newPageId(), blocks: [heading('Untitled survey')] }],
  },
  {
    id: 'nps',
    name: 'NPS + follow-up',
    description: 'Net Promoter Score, then a different follow-up for detractors and promoters.',
    category: 'Feedback',
    theme: {},
    build: () => {
      const score = q('nps', 'How likely are you to recommend us to a friend or colleague?', {
        required: true,
        scale: { min: 0, max: 10, minLabel: 'Not likely', maxLabel: 'Very likely' },
      })
      const low: SurveyPage = {
        id: newPageId(),
        title: 'What went wrong',
        blocks: [q('long_text', 'What could we have done better?', { placeholder: 'Tell us more…' })],
        defaultNext: { kind: 'end' },
      }
      const high: SurveyPage = {
        id: newPageId(),
        title: 'What went well',
        blocks: [q('long_text', 'What do you like most about us?', { placeholder: 'Tell us more…' })],
      }
      return [
        {
          id: newPageId(),
          title: 'Score',
          blocks: [heading('Quick question'), score],
          rules: [{ id: newBlockId(), when: { questionId: score.id, op: 'lte', value: 6 }, goTo: { kind: 'page', pageId: low.id } }],
          defaultNext: { kind: 'page', pageId: high.id },
        },
        low,
        high,
      ]
    },
  },
  {
    id: 'csat',
    name: 'Customer satisfaction',
    description: 'A star rating plus open feedback.',
    category: 'Feedback',
    theme: {},
    build: () => [
      {
        id: newPageId(),
        blocks: [
          heading('How did we do?'),
          q('rating', 'How satisfied are you with your recent experience?', { required: true, scale: { min: 1, max: 5, icon: 'star' } }),
          q('multiple_choice', 'What stood out?', { options: options('Speed', 'Quality', 'Support', 'Price'), allowOther: true }),
          q('long_text', 'Anything else you would like to share?'),
        ],
      },
    ],
  },
  {
    id: 'product-feedback',
    name: 'Product feedback',
    description: 'Usage, satisfaction and feature requests over two pages.',
    category: 'Research',
    theme: {},
    build: () => [
      {
        id: newPageId(),
        title: 'Your usage',
        blocks: [
          heading('Help us improve'),
          text('This takes about two minutes.'),
          q('single_choice', 'How often do you use the product?', { required: true, options: options('Daily', 'Weekly', 'Monthly', 'Rarely') }),
          q('scale', 'How easy is it to use?', { required: true, scale: { min: 1, max: 7, minLabel: 'Very hard', maxLabel: 'Very easy' } }),
        ],
      },
      {
        id: newPageId(),
        title: 'Ideas',
        blocks: [
          q('multiple_choice', 'Which areas should we focus on next?', { options: options('Performance', 'Integrations', 'Reporting', 'Mobile'), maxSelect: 2 }),
          q('long_text', 'If you could change one thing, what would it be?'),
        ],
      },
    ],
  },
  {
    id: 'event-feedback',
    name: 'Event feedback',
    description: 'Attendance, rating and whether they would come again.',
    category: 'Feedback',
    theme: {},
    build: () => [
      {
        id: newPageId(),
        blocks: [
          heading('Thanks for joining us'),
          q('rating', 'How would you rate the event overall?', { required: true, scale: { min: 1, max: 5, icon: 'star' } }),
          q('yes_no', 'Would you attend again?', { required: true }),
          q('long_text', 'What was the highlight for you?'),
        ],
      },
    ],
  },
  {
    id: 'lead-qualification',
    name: 'Lead qualification',
    description: 'Captures who they are and what they need, and writes it to the contact.',
    category: 'Lead gen',
    theme: {},
    build: () => [
      {
        id: newPageId(),
        title: 'About you',
        blocks: [
          heading('Tell us about you'),
          q('short_text', 'First name', { required: true, mapTo: { field: 'first_name', overwrite: 'if_empty' } }),
          q('email', 'Work email', { required: true }),
          q('short_text', 'Company', { mapTo: { field: 'company', overwrite: 'if_empty' } }),
          q('short_text', 'Job title', { mapTo: { field: 'job_title', overwrite: 'if_empty' } }),
        ],
      },
      {
        id: newPageId(),
        title: 'Your needs',
        blocks: [
          q('dropdown', 'Company size', { options: options('1–10', '11–50', '51–200', '201–1000', '1000+') }),
          q('single_choice', 'When are you looking to get started?', { options: options('Now', 'Within 3 months', 'Later this year', 'Just researching') }),
          q('long_text', 'What problem are you trying to solve?'),
        ],
      },
    ],
  },
]
