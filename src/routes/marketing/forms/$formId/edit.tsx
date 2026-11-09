import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Inbox, Share2 } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { queryKeys } from '../../../../queryKeys'
import { getContactFieldsFn, getFormFn, getSendersFn, listsFn, updateFormFn } from '../../../../server/functions'
import { FormBuilder, draftOf, type FormDraft } from '../../../../features/forms/components/FormBuilder'
import { toast } from '../../../../components/ui/toast'
import { FormStatus } from '../../../../features/forms/components/FormStatus'

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
      backLabel="Forms"
      onBack={() => navigate({ to: '/marketing/forms' })}
      barExtra={
        <div className="flex items-center gap-1">
          <Link to="/marketing/forms/$formId" params={{ formId }} className="inline-flex items-center gap-1.5 rounded-md-xs px-2 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <Inbox className="h-4 w-4" aria-hidden /> {form.submission_count} submission{form.submission_count === 1 ? '' : 's'}
          </Link>
          <Button variant="secondary" size="sm" leftIcon={<Share2 className="h-3.5 w-3.5" />} onClick={() => navigate({ to: '/marketing/forms/$formId/edit', params: { formId }, search: { share: 'open' } })}>
            Share
          </Button>
        </div>
      }
      status={<FormStatus paused={!!form.paused} />}
      subtitle={form.paused ? "Paused: it won't take submissions until you resume it." : 'Live: saved changes show on your site straight away.'}
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
