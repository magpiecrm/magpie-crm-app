import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { setContactCustomFn } from '../../../server/functions'
import { patchContactCustom } from '../contactCache'
import { formatCustomValue, type ContactCustomValue, type ContactFieldDef } from '../contactFields'
import { formatDay } from '../record'
import { CustomFieldInput } from './CustomFieldInput'
import { DetailRow, PanelSection, SECTION_ACTION, ShowEmpty } from '../../../components/ui/RecordSection'

function display(field: ContactFieldDef, value: ContactCustomValue | undefined): string {
  if (field.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDay(`${value.slice(0, 10)}T12:00:00Z`)
  return formatCustomValue(value)
}

/** A contact's custom fields on their page, with a way to change them. */
export function ContactCustomFields({ email, defs, custom }: { email: string; defs: ContactFieldDef[]; custom: Record<string, ContactCustomValue> }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, ContactCustomValue> | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [showEmpty, setShowEmpty] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      // Only what changed, so a value that no longer fits its field can stay as it is.
      const values = Object.fromEntries(Object.entries(draft ?? {}).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(custom[key] ?? null)))
      return setContactCustomFn({ data: { email, values } })
    },
    onSuccess: (result) => {
      patchContactCustom(queryClient, email, result.custom)
      setProblems(result.problems)
      if (result.problems.length === 0) setDraft(null)
    },
  })

  if (defs.length === 0) return null

  const startEditing = () => {
    setProblems([])
    setDraft(Object.fromEntries(defs.map((f) => [f.key, custom[f.key] ?? null])))
  }

  if (!draft) {
    const filled = defs.filter((f) => display(f, custom[f.key]))
    const empty = defs.length - filled.length
    const shown = showEmpty ? defs : filled
    return (
      <PanelSection
        title="Custom fields"
        action={
          <button type="button" onClick={startEditing} className={SECTION_ACTION} aria-label="Edit custom fields">
            <Pencil aria-hidden className="h-3 w-3" />
            Edit
          </button>
        }
      >
        {shown.length > 0 && (
          <dl>
            {shown.map((field) => (
              <DetailRow key={field.key} label={field.label}>
                {display(field, custom[field.key]) || <span className="text-muted-foreground">Not set</span>}
              </DetailRow>
            ))}
          </dl>
        )}
        {shown.length === 0 && !showEmpty && <p className="text-[13px] text-muted-foreground">None filled in yet.</p>}
        {empty > 0 && <ShowEmpty shown={showEmpty} count={empty} onToggle={() => setShowEmpty((s) => !s)} />}
      </PanelSection>
    )
  }

  return (
    <PanelSection title="Custom fields">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        {defs.map((field) => (
          <Field key={field.key} as="div" label={field.label}>
            <CustomFieldInput field={field} value={draft[field.key]} saved={custom[field.key]} onChange={(value) => setDraft({ ...draft, [field.key]: value })} ariaLabel={field.label} />
          </Field>
        ))}
        {problems.map((problem) => (
          <Notice key={problem} level="error">
            {problem}
          </Notice>
        ))}
        {save.error && <Notice level="error">{save.error.message}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" isLoading={save.isPending}>
            Save
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      </form>
    </PanelSection>
  )
}
