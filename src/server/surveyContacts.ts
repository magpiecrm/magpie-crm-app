import { db } from './db'
import type { Answers, Survey } from '../features/survey-builder/types'
import { isQuestionType } from '../features/survey-builder/types'
import { coerceForField } from '../features/survey-builder/logic/answers'
import type { ContactCustomValue } from '../features/contacts/contactFields'

const isBlank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

/**
 * Write a respondent's mapped answers onto their contact record.
 *
 * Runs on every save of an identified response, so an answer given inline in
 * an email is mapped even if the rest of the survey is never finished.
 * Status and email are never changed. Returns whether a contact was created.
 */
export function applySurveyToContact(
  survey: Survey,
  answers: Answers,
  email: string,
  opts: { allowCreate: boolean },
): { created: boolean; updated: boolean } {
  const fieldDefs = db.getContactFields()
  const existing = db.getContact(email)
  const builtin: Record<string, string> = {}
  const custom: Record<string, ContactCustomValue> = {}

  for (const page of survey.design.pages) {
    for (const block of page.blocks) {
      const mapTo = block.question?.mapTo
      if (!mapTo || !isQuestionType(block.type)) continue
      const answer = answers[block.id]
      if (answer === undefined || answer === null) continue

      if (mapTo.field.startsWith('custom:')) {
        const key = mapTo.field.slice('custom:'.length)
        const def = fieldDefs.find(f => f.key === key)
        if (!def) continue
        const value = coerceForField(block, answer, def)
        if (value === undefined) continue
        if (mapTo.overwrite === 'if_empty' && !isBlank(existing?.custom?.[key])) continue
        custom[key] = value
      } else {
        const value = coerceForField(block, answer)
        if (typeof value !== 'string') continue
        const field = mapTo.field as 'first_name' | 'last_name' | 'job_title' | 'company'
        if (mapTo.overwrite === 'if_empty' && !isBlank(existing?.[field])) continue
        builtin[field] = value.slice(0, 200)
      }
    }
  }

  const hasPatch = Object.keys(builtin).length > 0 || Object.keys(custom).length > 0
  if (!existing && !opts.allowCreate) return { created: false, updated: false }
  if (existing && !hasPatch) return { created: false, updated: false }

  const { created } = db.upsertContact(email, { builtin, custom }, { create: opts.allowCreate, status: 'subscribed' })
  if (created && survey.settings.listId) db.addContactToList(survey.settings.listId, email)
  return { created, updated: hasPatch }
}
