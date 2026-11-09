import React, { useState, type ComponentType, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { Select } from '../../../components/ui/Select'
import { createContactFieldFn } from '../../../server/functions'
import { CONTACT_FIELD_TYPES, hasOptions, parseOptions, slugifyFieldKey, TYPE_LABELS, validateFieldKey, type ContactFieldDef, type ContactFieldType, type ContactTableView } from '../contactFields'

/** Making a custom field, from Settings, a table's Add column or an import. */
export function ContactFieldForm({
  initial,
  showIn,
  submitLabel,
  onCreated,
  Actions = Row,
  extraActions,
  cols = 2,
  onCancel,
}: {
  initial?: { label: string; type: ContactFieldType; options?: string[] }
  /** Show it on this table straight away. */
  showIn?: ContactTableView
  submitLabel: string
  onCreated: (field: ContactFieldDef) => void
  /** What holds the buttons. */
  Actions?: ComponentType<{ children: ReactNode }>
  extraActions?: ReactNode
  /** Fields across: 3 where there's room (Settings), 2 in a narrow panel. */
  cols?: 2 | 3
  /** Inside a Dialog: the fields scroll in its body and the buttons (Cancel, then this) sit in its footer. */
  onCancel?: () => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<ContactFieldType>(initial?.type ?? 'text')
  const [options, setOptions] = useState((initial?.options ?? []).join(', '))
  const effectiveKey = keyTouched ? key : slugifyFieldKey(label)
  const keyError = label || keyTouched ? validateFieldKey(effectiveKey) : null

  const create = useMutation({
    mutationFn: () => createContactFieldFn({ data: { key: effectiveKey, label: label.trim(), type, options: hasOptions(type) ? parseOptions(options) : undefined, showIn } }),
    onSuccess: (field) => {
      setLabel('')
      setKey('')
      setKeyTouched(false)
      setOptions('')
      setType('text')
      onCreated(field)
    },
  })

  const fieldsBlock = (
    <>
      <FieldGrid cols={cols}>
        <Field label="Label">
          <input required autoFocus={!!onCancel} className={INPUT_CLASS} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Industry" />
        </Field>
        <Field label="Key" hint="Can't be changed later." error={keyError ?? undefined}>
          <input
            className={INPUT_CLASS}
            value={effectiveKey}
            onChange={(e) => {
              setKeyTouched(true)
              setKey(e.target.value)
            }}
            placeholder="industry"
          />
        </Field>
        <Field label="Type">
          <Select className={INPUT_CLASS} value={type} onChange={(e) => setType(e.target.value as ContactFieldType)}>
            {CONTACT_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        {hasOptions(type) && (
          <Field label="Options" hint="Separate them with commas.">
            <input className={INPUT_CLASS} value={options} onChange={(e) => setOptions(e.target.value)} placeholder="e.g. SaaS, Retail, Finance" />
          </Field>
        )}
      </FieldGrid>
      {!keyError && create.error && <Notice level="error">{create.error.message}</Notice>}
    </>
  )
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!keyError && label.trim()) create.mutate()
  }

  if (onCancel) {
    return (
      <form className="flex min-h-0 flex-col" onSubmit={submit}>
        <DialogBody className="flex flex-col gap-3">{fieldsBlock}</DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!!keyError} isLoading={create.isPending}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    )
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      {fieldsBlock}
      <Actions>
        <Button type="submit" disabled={!!keyError} isLoading={create.isPending} leftIcon={<Plus className="h-4 w-4" />}>
          {submitLabel}
        </Button>
        {extraActions}
      </Actions>
    </form>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}
