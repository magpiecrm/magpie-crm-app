import { visibleColumns } from '../features/contacts/contactColumns'
import { coerceCustomValue, fieldProblem, FIELD_LIMITS, hasOptions, validateFieldKey, type ContactCustomValue, type ContactFieldDef, type ContactFieldType, type ContactTableView } from '../features/contacts/contactFields'
import { db } from './db'

// Custom fields and their values, whoever is writing: the pages, import and the
// copilot all come through here, so what's stored always fits its field. A
// built-in like first_name isn't a field, so it can't be written this way.

/** Adds a field; `showIn` puts it on that table at once, as from Add column or an import. */
export function createField(input: { key: string; label: string; type: ContactFieldType; options?: string[] }, opts: { showIn?: ContactTableView } = {}): ContactFieldDef {
  const fields = db.getContactFields()
  if (fields.length >= FIELD_LIMITS.fields) throw new Error(`A workspace can have up to ${FIELD_LIMITS.fields} fields.`)
  const keyProblem = validateFieldKey(input.key)
  if (keyProblem) throw new Error(keyProblem)
  const def = { key: input.key, label: input.label.trim(), type: input.type, ...(hasOptions(input.type) ? { options: input.options ?? [] } : {}) }
  const problem = fieldProblem(def, fields)
  if (problem) throw new Error(problem)
  const showIn = opts.showIn
  if (!showIn) return db.addContactField(def)
  const columns = visibleColumns(showIn, db.getContactColumns()[showIn], fields)
  // At the limit the field still exists, it just isn't shown.
  return db.addContactField(def, columns.length < FIELD_LIMITS.visibleColumns ? { showIn: { view: showIn, columns: [...columns, `custom:${def.key}`] } } : {})
}

export function editField(key: string, patch: { label: string; options?: string[] }): ContactFieldDef {
  const fields = db.getContactFields()
  const field = fields.find((f) => f.key === key)
  if (!field) throw new Error('Field not found')
  const next = { label: patch.label.trim(), ...(hasOptions(field.type) ? { options: patch.options ?? [] } : {}) }
  const problem = fieldProblem({ ...field, ...next }, fields.filter((f) => f.key !== key))
  if (problem) throw new Error(problem)
  return db.updateContactField(key, next)
}

export interface CustomUpdate {
  email: string
  values: Record<string, unknown>
}

export interface CustomWriteResult {
  updated: number
  notFound: string[]
  problems: Array<{ email: string; field: string; problem: string }>
}

/**
 * Writes custom values, in one save. A value that doesn't fit its field is
 * reported and left as it was. `blanks` says what an empty value does: `clear`
 * removes what's there, `keep` leaves it, as an import does.
 */
export function writeCustomValues(updates: CustomUpdate[], opts: { blanks: 'clear' | 'keep' }): CustomWriteResult {
  const defs = new Map(db.getContactFields().map((f) => [f.key, f]))
  const contacts = new Map(db.data.contacts.map((c) => [c.email, c]))
  const result: CustomWriteResult = { updated: 0, notFound: [], problems: [] }
  const changes: Array<{ email: string; custom: Record<string, ContactCustomValue> }> = []
  for (const update of updates) {
    const email = update.email.toLowerCase().trim()
    const contact = contacts.get(email)
    if (!contact) {
      result.notFound.push(email)
      continue
    }
    const custom = { ...contact.custom }
    let changed = false
    for (const [key, raw] of Object.entries(update.values)) {
      const def = defs.get(key)
      if (!def) {
        result.problems.push({ email, field: key, problem: `There's no field "${key}".` })
        continue
      }
      const coerced = coerceCustomValue(raw, def, { current: contact.custom?.[key] })
      if (!coerced.ok) {
        result.problems.push({ email, field: key, problem: coerced.problem })
      } else if (coerced.value !== null) {
        changed ||= JSON.stringify(coerced.value) !== JSON.stringify(custom[key])
        custom[key] = coerced.value
      } else if (opts.blanks === 'clear' && key in custom) {
        delete custom[key]
        changed = true
      }
    }
    if (!changed) continue
    if (JSON.stringify(custom).length > FIELD_LIMITS.customJson) {
      result.problems.push({ email, field: '', problem: "That's more custom data than a contact can hold." })
      continue
    }
    changes.push({ email, custom })
  }
  if (changes.length) {
    db.mutate(() => {
      for (const { email, custom } of changes) contacts.get(email)!.custom = custom
    })
  }
  result.updated = changes.length
  return result
}
