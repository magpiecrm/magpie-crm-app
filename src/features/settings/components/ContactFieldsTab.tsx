import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import {
  createContactFieldFn,
  deleteContactFieldFn,
  getContactFieldsFn,
  updateContactFieldFn,
} from '../../../server/functions'
import type { ContactFieldDef, ContactFieldType } from '../../contacts/contactFields'
import { CONTACT_FIELD_TYPES, slugifyFieldKey, validateFieldKey } from '../../contacts/contactFields'

const INPUT_CLASS =
  'w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent'

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
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="card border border-border rounded-md-m p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">Add a contact field</h2>
          <p className="text-sm text-muted-foreground">
            Custom fields appear on contact profiles and exports, and survey answers can be saved to them.
          </p>
        </div>
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          onSubmit={e => {
            e.preventDefault()
            if (!keyError && label.trim()) createMutation.mutate()
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Label</span>
            <input className={INPUT_CLASS} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Industry" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Key (can't be changed later)</span>
            <input
              className={INPUT_CLASS}
              value={effectiveKey}
              onChange={e => {
                setKeyTouched(true)
                setKey(e.target.value)
              }}
              placeholder="industry"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Type</span>
            <select className={INPUT_CLASS} value={type} onChange={e => setType(e.target.value as ContactFieldType)}>
              {CONTACT_FIELD_TYPES.map(t => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {hasOptions(type) && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Options (comma separated)</span>
              <input className={INPUT_CLASS} value={options} onChange={e => setOptions(e.target.value)} placeholder="SaaS, Retail, Finance" />
            </label>
          )}
          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={!label.trim() || !!keyError || createMutation.isPending}
              className="bg-accent text-accent-foreground px-4 py-2 rounded-md-s text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Add field
            </button>
            {(keyError || createMutation.error) && (
              <span className="text-sm text-destructive">{keyError || createMutation.error?.message}</span>
            )}
          </div>
        </form>
      </div>

      <div className="card border border-border rounded-md-m overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : fields.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No custom fields yet.</div>
        ) : (
          <ul className="divide-y divide-border">
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
          </ul>
        )}
      </div>
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

  if (editing) {
    return (
      <li className="p-4 flex flex-col sm:flex-row gap-2 sm:items-center">
        <input className={INPUT_CLASS} value={label} onChange={e => setLabel(e.target.value)} />
        {hasOptions(field.type) && <input className={INPUT_CLASS} value={options} onChange={e => setOptions(e.target.value)} />}
        <div className="flex gap-1 shrink-0">
          <button title="Save" onClick={() => saveMutation.mutate()} className="p-2 rounded-md-s hover:bg-muted cursor-pointer">
            <Check className="w-4 h-4" />
          </button>
          <button title="Cancel" onClick={() => setEditing(false)} className="p-2 rounded-md-s hover:bg-muted cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground">{field.label}</div>
        <div className="text-xs text-muted-foreground">
          <code>{field.key}</code> · {TYPE_LABELS[field.type]}
          {field.options?.length ? ` · ${field.options.join(', ')}` : ''}
        </div>
      </div>
      <button title="Edit" onClick={() => setEditing(true)} className="p-1.5 rounded-md-s text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button title="Delete" onClick={onDelete} className="p-1.5 rounded-md-s text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  )
}
