import type { ContactFieldDef } from './contactFields'

export interface MergeTagOption {
  /** As the block editor's dynamic field saves it. */
  path: string
  label: string
}

const BUILT_IN: MergeTagOption[] = [
  { path: 'contact.FIRSTNAME', label: 'First name' },
  { path: 'contact.LASTNAME', label: 'Last name' },
  { path: 'contact.COMPANY', label: 'Company' },
  { path: 'contact.EMAIL', label: 'Email' },
]

/** What can go in an email about a contact: only tags that are filled in when it sends (mergeTags.ts). */
export const mergeTagOptions = (fields: Array<Pick<ContactFieldDef, 'key' | 'label'>>): MergeTagOption[] => [...BUILT_IN, ...fields.map((f) => ({ path: `contact.custom.${f.key}`, label: f.label }))]

export const mergeTagText = (option: MergeTagOption) => `{{ ${option.path} }}`
