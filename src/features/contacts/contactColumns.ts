import { FIELD_LIMITS, type ContactFieldDef, type ContactTableView } from './contactFields'

/** A contact table's columns: built-ins by name, custom fields as `custom:<key>`. The first never moves or hides. */
export const PINNED_COLUMN = 'contact'

export const DEFAULT_COLUMNS: Record<ContactTableView, string[]> = {
  contacts: [PINNED_COLUMN, 'status', 'blocklisted', 'email', 'country', 'created_at'],
  list: [PINNED_COLUMN, 'email', 'company', 'job_title', 'created_at'],
}

/** Every built-in column, with its heading. */
export const BUILTIN_COLUMNS: Array<{ id: string; label: string }> = [
  { id: PINNED_COLUMN, label: 'Contact' },
  { id: 'email', label: 'Email' },
  { id: 'status', label: 'Subscribed' },
  { id: 'blocklisted', label: 'Blocklisted' },
  { id: 'company', label: 'Company' },
  { id: 'job_title', label: 'Job title' },
  { id: 'country', label: 'Country' },
  { id: 'created_at', label: 'Date added' },
]

const known = (id: string, defs: ContactFieldDef[]) =>
  id.startsWith('custom:') ? defs.some((d) => `custom:${d.key}` === id) : BUILTIN_COLUMNS.some((c) => c.id === id)

/** What a table shows: what's saved, or its defaults, without anything that's gone (a restored backup can bring a deleted field's column back). */
export function visibleColumns(view: ContactTableView, saved: string[] | undefined, defs: ContactFieldDef[]): string[] {
  const shown = (saved ?? DEFAULT_COLUMNS[view]).filter((id) => id !== PINNED_COLUMN && known(id, defs))
  return [PINNED_COLUMN, ...new Set(shown)]
}

/** The columns to save, or what's wrong with them: the pinned column first, nothing twice, nothing unknown. */
export function columnsToSave(columns: string[], defs: ContactFieldDef[]): string[] {
  const unknown = columns.find((id) => !known(id, defs))
  if (unknown) throw new Error(`There's no column "${unknown}".`)
  const unique = [PINNED_COLUMN, ...new Set(columns.filter((id) => id !== PINNED_COLUMN))]
  if (unique.length > FIELD_LIMITS.visibleColumns) throw new Error(`A table can show up to ${FIELD_LIMITS.visibleColumns} columns.`)
  return unique
}
