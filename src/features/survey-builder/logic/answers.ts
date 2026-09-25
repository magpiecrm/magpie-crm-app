import type { ContactCustomValue, ContactFieldDef } from '../../contacts/contactFields'
import type { AnswerValue, SurveyBlock } from '../types'

/** Human-readable answer, for results tables, CSV export and the contact profile. */
export function answerToDisplay(block: SurveyBlock | undefined, value: AnswerValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') {
    const labels = value.optionIds.map(id => block?.question?.options?.find(o => o.id === id)?.label ?? id)
    if (value.other) labels.push(`Other: ${value.other}`)
    return labels.join(', ')
  }
  return String(value)
}

function choiceLabels(block: SurveyBlock, value: AnswerValue): string[] {
  if (!value || typeof value !== 'object') return []
  const labels = value.optionIds.map(id => block.question?.options?.find(o => o.id === id)?.label ?? id)
  if (value.other) labels.push(value.other)
  return labels
}

/**
 * Convert an answer to the type of the contact field it maps to. Returns
 * `undefined` when the answer cannot be represented, so the caller skips the
 * write instead of storing junk.
 *
 * `field` is undefined for built-in columns, which are all text.
 */
export function coerceForField(
  block: SurveyBlock,
  value: AnswerValue,
  field?: ContactFieldDef,
): ContactCustomValue | undefined {
  if (value === null) return undefined
  const type = field?.type ?? 'text'
  const isChoice = typeof value === 'object'

  switch (type) {
    case 'text':
      return answerToDisplay(block, value) || undefined
    case 'number':
      return typeof value === 'number' ? value : undefined
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
    case 'select': {
      const label = isChoice ? choiceLabels(block, value)[0] : typeof value === 'string' ? value : undefined
      if (label === undefined) return undefined
      return !field?.options?.length || field.options.includes(label) ? label : undefined
    }
    case 'multiselect': {
      const labels = isChoice ? choiceLabels(block, value) : typeof value === 'string' ? [value] : []
      const allowed = field?.options?.length ? labels.filter(l => field.options!.includes(l)) : labels
      return allowed.length ? allowed : undefined
    }
  }
}

/** Which field types a question type can sensibly map to. */
export function compatibleFieldTypes(block: SurveyBlock): Array<ContactFieldDef['type']> {
  switch (block.type) {
    case 'number':
    case 'rating':
    case 'nps':
    case 'scale':
      return ['number', 'text']
    case 'date':
      return ['date', 'text']
    case 'yes_no':
      return ['boolean', 'text']
    case 'single_choice':
    case 'dropdown':
      return ['select', 'text']
    case 'multiple_choice':
      return ['multiselect', 'text']
    default:
      return ['text']
  }
}
