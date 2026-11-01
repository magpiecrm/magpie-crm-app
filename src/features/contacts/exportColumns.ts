import type { ExportColumn } from '../../utils/export'
import { BUILTIN_EXPORT_HEADERS, formatCustomValue, type ContactCustomValue, type ContactFieldDef } from './contactFields'

/**
 * Contact rows as returned by `contactsFn` / `listContactsFn`
 * (see `getContacts` in `src/server/emailService.ts`).
 */
export interface ExportableContact {
  email: string
  status?: string
  createdAt?: string
  attributes?: {
    FIRSTNAME?: string
    LASTNAME?: string
    JOB_TITLE?: string
    COMPANY?: string
  }
  custom?: Record<string, ContactCustomValue>
  country?: string
  linkedinUrl?: string
}

/**
 * Headers match the ones the importer recognises (`marketing/contacts/import`),
 * so an exported file can be fed straight back in.
 */
const contactExportColumns: ExportColumn<ExportableContact>[] = [
  { header: 'Email', value: c => c.email },
  { header: 'First Name', value: c => c.attributes?.FIRSTNAME ?? '' },
  { header: 'Last Name', value: c => c.attributes?.LASTNAME ?? '' },
  { header: 'Job Title', value: c => c.attributes?.JOB_TITLE ?? '' },
  { header: 'Company', value: c => c.attributes?.COMPANY ?? '' },
  { header: 'Country', value: c => c.country ?? '' },
  { header: 'LinkedIn URL', value: c => c.linkedinUrl ?? '' },
  { header: 'Status', value: c => c.status ?? '' },
  { header: 'Created At', value: c => c.createdAt ?? '' },
]

/** A custom field's header: its label, or with its key where the label alone isn't unique (fields from before labels had to be). */
export function exportHeader(field: ContactFieldDef, fieldDefs: ContactFieldDef[]): string {
  const label = field.label.toLowerCase()
  const clash = BUILTIN_EXPORT_HEADERS.some(h => h.toLowerCase() === label) || fieldDefs.some(f => f !== field && f.label.toLowerCase() === label)
  return clash ? `${field.label} (${field.key})` : field.label
}

/** The standard columns plus one per custom contact field. */
export function contactExportColumnsWith(fieldDefs: ContactFieldDef[]): ExportColumn<ExportableContact>[] {
  return [
    ...contactExportColumns,
    ...fieldDefs.map(f => ({ header: exportHeader(f, fieldDefs), value: (c: ExportableContact) => formatCustomValue(c.custom?.[f.key]) })),
  ]
}
