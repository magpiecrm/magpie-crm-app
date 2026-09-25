import type { SurveyBlock, SurveyBlockType } from '../types'
import { newBlockId, newOptionId, normalizeBlock } from '../applyAction'

/** Placeholder content for a freshly added block, so it is never blank on the canvas. */
export function createSurveyBlock(type: SurveyBlockType): SurveyBlock {
  const options = (...labels: string[]) => labels.map(label => ({ id: newOptionId(), label }))
  const base = { id: newBlockId(), type }

  switch (type) {
    case 'heading':
      return { ...base, content: 'Section heading' }
    case 'text':
      return { ...base, content: 'Add some context or instructions for this part of the survey.' }
    case 'image':
      return { ...base, content: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop', alt: '' }
    case 'spacer':
      return { ...base, style: { height: 24 } }
    case 'html':
      return { ...base, content: '<p>Custom HTML</p>' }
    case 'divider':
      return base
    case 'short_text':
      return normalizeBlock({ ...base, question: { title: 'Your answer', required: false } })
    case 'long_text':
      return normalizeBlock({ ...base, question: { title: 'Tell us more', required: false, placeholder: 'Type your answer…' } })
    case 'email':
      return normalizeBlock({ ...base, question: { title: 'Your email address', required: true, placeholder: 'name@company.com' } })
    case 'number':
      return normalizeBlock({ ...base, question: { title: 'Enter a number', required: false } })
    case 'date':
      return normalizeBlock({ ...base, question: { title: 'Pick a date', required: false } })
    case 'single_choice':
    case 'dropdown':
      return normalizeBlock({ ...base, question: { title: 'Choose one', required: false, options: options('Option 1', 'Option 2', 'Option 3') } })
    case 'multiple_choice':
      return normalizeBlock({ ...base, question: { title: 'Choose all that apply', required: false, options: options('Option 1', 'Option 2', 'Option 3') } })
    case 'rating':
      return normalizeBlock({ ...base, question: { title: 'How would you rate it?', required: false, scale: { min: 1, max: 5, icon: 'star' } } })
    case 'nps':
      return normalizeBlock({
        ...base,
        question: {
          title: 'How likely are you to recommend us to a friend or colleague?',
          required: true,
          scale: { min: 0, max: 10, minLabel: 'Not likely', maxLabel: 'Very likely' },
        },
      })
    case 'scale':
      return normalizeBlock({
        ...base,
        question: { title: 'How much do you agree?', required: false, scale: { min: 1, max: 5, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' } },
      })
    case 'yes_no':
      return normalizeBlock({ ...base, question: { title: 'Yes or no?', required: false } })
  }
}
