import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { setContactCustomFn } from '../../../server/functions'
import { patchContactCustom } from '../contactCache'
import { formatCustomValue, type ContactCustomValue, type ContactFieldDef } from '../contactFields'
import { CustomFieldInput } from './CustomFieldInput'

/** A contact's custom fields on their profile, with a way to change them. */
export function ContactCustomFields({ email, defs, custom }: { email: string; defs: ContactFieldDef[]; custom: Record<string, ContactCustomValue> }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, ContactCustomValue> | null>(null)
  const [problems, setProblems] = useState<string[]>([])

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

  if (!draft) {
    return (
      <>
        {defs.map((field) => (
          <div key={field.key}>
            <span className="text-muted-foreground block font-medium mb-0.5">{field.label}</span>
            <span className="font-bold text-foreground break-words">{formatCustomValue(custom[field.key]) || '—'}</span>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setProblems([])
            setDraft(Object.fromEntries(defs.map((f) => [f.key, custom[f.key] ?? null])))
          }}
          className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline cursor-pointer"
        >
          <Pencil className="w-3 h-3" />
          Edit custom fields
        </button>
      </>
    )
  }

  return (
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
  )
}
