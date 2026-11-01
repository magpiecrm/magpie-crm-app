import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import {
  deleteContactFieldFn,
  getContactFieldsFn,
  updateContactFieldFn,
} from '../../../server/functions'
import type { ContactFieldDef } from '../../contacts/contactFields'
import { hasOptions, parseOptions, TYPE_LABELS } from '../../contacts/contactFields'
import { ContactFieldForm } from '../../contacts/components/ContactFieldForm'
import { invalidateContactFields } from '../../contacts/contactCache'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'

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
  const invalidate = () => invalidateContactFields(queryClient)

  const deleteMutation = useMutation({
    mutationFn: (key: string) => deleteContactFieldFn({ data: { key } }),
    onSuccess: invalidate,
  })

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanel>
        <SettingsBlock
          title="Your fields"
          description="Custom fields can be shown as columns in your contacts, filled in by hand, by import or from survey answers, and used in emails."
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
          <ContactFieldForm submitLabel="Add field" onCreated={invalidate} Actions={SettingsActions} />
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
          {saveMutation.error && <Notice level="error">{saveMutation.error.message}</Notice>}
          <SettingsActions>
            <Button size="sm" onClick={() => saveMutation.mutate()} isLoading={saveMutation.isPending}>
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
