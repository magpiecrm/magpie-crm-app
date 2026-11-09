import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { queryKeys } from '../../../../queryKeys'
import { getContactFieldsFn, getFormFn, getSendersFn, listsFn, updateFormFn } from '../../../../server/functions'
import { FormBuilder, draftOf, type FormDraft } from '../../../../features/forms/components/FormBuilder'
import { toast } from '../../../../components/ui/toast'

export const Route = createFileRoute('/marketing/forms/$formId/edit')({
  component: EditFormPage,
})

function EditFormPage() {
  const { formId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: form } = useQuery({ queryKey: queryKeys.email.form(formId), queryFn: () => getFormFn({ data: { id: formId } }), retry: false })
  const { data: listsData } = useQuery({ queryKey: queryKeys.email.lists(), queryFn: () => listsFn() })
  const { data: sendersData } = useQuery({ queryKey: queryKeys.email.senders(), queryFn: () => getSendersFn() })
  const { data: contactFields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })
  const lists = (listsData?.lists ?? []) as Array<{ id: number; name: string }>
  const senders = (sendersData?.senders ?? []) as Array<{ id: number; name: string; email: string }>

  const save = useMutation({
    mutationFn: (draft: FormDraft) => updateFormFn({ data: { id: formId, updates: draft } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.email.forms() })
      toast.success('Changes saved', { description: 'Embedded forms show them straight away.' })
    },
  })

  // Stays the same object until the saved form changes, so "Unsaved changes" compares against what's stored.
  const initial = useMemo(() => (form ? draftOf(form) : null), [form])
  if (!initial || !form) return null

  return (
    <FormBuilder
      key={form.updated_at ?? form.created_at}
      isNew={false}
      initial={initial}
      lists={lists}
      senders={senders}
      contactFields={contactFields}
      saving={save.isPending}
      error={save.error?.message}
      onSave={(draft) => save.mutate(draft)}
      onCancel={() => navigate({ to: '/marketing/forms/$formId', params: { formId } })}
    />
  )
}
