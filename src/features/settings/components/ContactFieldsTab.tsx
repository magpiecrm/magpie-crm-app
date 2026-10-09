import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import {
  createContactFieldFn,
  deleteContactFieldFn,
  getContactFieldsFn,
  updateContactFieldFn,
} from '../../../server/functions'
import type { ContactFieldDef, ContactFieldType } from '../../contacts/contactFields'
import { CONTACT_FIELD_TYPES, slugifyFieldKey, validateFieldKey } from '../../contacts/contactFields'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { Select } from '../../../components/ui/Select'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'

const TYPE_LABELS: Record<ContactFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / No',
  select: 'Single select',
  multiselect: 'Multi select',
}

const hasOptions = (type: ContactFieldType) => type === 'select' || type === 'multiselect'

const parseOptions = (raw: string) =>
  raw
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

/**
 * User-defined contact attributes. Survey questions can map answers onto
 * these, and they show on the contact profile and in exports.
 */
export function ContactFieldsTab() {
  const queryClient = useQueryClient()
  const { data: fields = [], isLoading } = useQuery({
    queryKey: queryKeys.email.contactFields(),
    queryFn: () => getContactFieldsFn(),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.email.contactFields() })

  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<ContactFieldType>('text')
  const [options, setOptions] = useState('')
  const effectiveKey = keyTouched ? key : slugifyFieldKey(label)
  const keyError = label || keyTouched ? validateFieldKey(effectiveKey) : null

  const createMutation = useMutation({
    mutationFn: () =>
      createContactFieldFn({
        data: { key: effectiveKey, label: label.trim(), type, options: hasOptions(type) ? parseOptions(options) : undefined },
      }),
    onSuccess: () => {
      invalidate()
      setLabel('')
      setKey('')
      setKeyTouched(false)
      setOptions('')
      setType('text')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (key: string) => deleteContactFieldFn({ data: { key } }),
    onSuccess: invalidate,
  })

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanel>
        <SettingsBlock
          title="Your fields"
          description="Custom fields appear on contact profiles and exports, and survey answers can be saved to them."
        >
          {isLoading ? (
            <SettingsEmpty>Loading…</SettingsEmpty>
          ) : fields.length === 0 ? (
            <SettingsEmpty>No custom fields yet.</SettingsEmpty>
          ) : (
            <SettingsList>
              {fields.map(field => (
                <FieldRow
                  key={field.key}
                  field={field}
                  onSaved={invalidate}
                  onDelete={() => {
                    if (confirm(`Delete "${field.label}"? Its value will be removed from every contact.`)) deleteMutation.mutate(field.key)
                  }}
                />
              ))}
            </SettingsList>
          )}
        </SettingsBlock>

        <SettingsBlock title="Add a field">
          <form
            className="flex flex-col gap-3"
            onSubmit={e => {
              e.preventDefault()
              if (!keyError && label.trim()) createMutation.mutate()
            }}
          >
            <FieldGrid>
              <Field label="Label">
                <input className={INPUT_CLASS} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Industry" />
              </Field>
              <Field label="Key" hint="Can't be changed later." error={keyError ?? undefined}>
                <input
                  className={INPUT_CLASS}
                  value={effectiveKey}
                  onChange={e => {
                    setKeyTouched(true)
                    setKey(e.target.value)
                  }}
                  placeholder="industry"
                />
              </Field>
              <Field label="Type">
                <Select className={INPUT_CLASS} value={type} onChange={e => setType(e.target.value as ContactFieldType)}>
                  {CONTACT_FIELD_TYPES.map(t => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              {hasOptions(type) && (
                <Field label="Options" hint="Separate them with commas.">
                  <input className={INPUT_CLASS} value={options} onChange={e => setOptions(e.target.value)} placeholder="SaaS, Retail, Finance" />
                </Field>
              )}
            </FieldGrid>
            {!keyError && createMutation.error && <Notice level="error">{createMutation.error.message}</Notice>}
            <SettingsActions>
              <Button type="submit" disabled={!label.trim() || !!keyError} isLoading={createMutation.isPending} leftIcon={<Plus className="h-4 w-4" />}>
                Add field
              </Button>
            </SettingsActions>
          </form>
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}

function FieldRow({ field, onSaved, onDelete }: { field: ContactFieldDef; onSaved: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(field.label)
  const [options, setOptions] = useState((field.options ?? []).join(', '))

  const saveMutation = useMutation({
    mutationFn: () =>
      updateContactFieldFn({
        data: { key: field.key, label: label.trim(), options: hasOptions(field.type) ? parseOptions(options) : undefined },
      }),
    onSuccess: () => {
      setEditing(false)
      onSaved()
    },
  })

  return (
    <SettingsRow
      title={field.label}
      detail={
        <>
          <code className="font-mono">{field.key}</code> · {TYPE_LABELS[field.type]}
          {field.options?.length ? ` · ${field.options.join(', ')}` : ''}
        </>
      }
      actions={
        // While editing, the form's own buttons are the only actions.
        editing ? undefined : (
          <>
            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label={`Edit ${field.label}`} title="Edit" leftIcon={<Pencil className="h-4 w-4" />} />
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label={`Delete ${field.label}`}
              title="Delete"
              className="hover:!bg-destructive/10 hover:!text-destructive"
              leftIcon={<Trash2 className="h-4 w-4" />}
            />
          </>
        )
      }
    >
      {editing && (
        <div className="flex flex-col gap-3">
          <FieldGrid>
            <Field label="Label">
              <input className={INPUT_CLASS} value={label} onChange={e => setLabel(e.target.value)} />
            </Field>
            {hasOptions(field.type) && (
              <Field label="Options" hint="Separate them with commas.">
                <input className={INPUT_CLASS} value={options} onChange={e => setOptions(e.target.value)} />
              </Field>
            )}
          </FieldGrid>
          <SettingsActions>
            <Button size="sm" onClick={() => saveMutation.mutate()}>
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </SettingsActions>
        </div>
      )}
    </SettingsRow>
  )
}
