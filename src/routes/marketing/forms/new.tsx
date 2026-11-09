import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createFormFn, getContactFieldsFn, getSendersFn, listsFn } from '../../../server/functions'
import { FormBuilder } from '../../../features/forms/components/FormBuilder'
import { FORM_TEMPLATES, templateDraft } from '../../../features/forms/templates'
import { TemplateTiles } from '../../../features/forms/components/TemplateTiles'

export const Route = createFileRoute('/marketing/forms/new')({
  validateSearch: (search: Record<string, unknown>): { template?: string } => (typeof search.template === 'string' ? { template: search.template } : {}),
  component: NewFormPage,
})

function NewFormPage() {
  const { template } = Route.useSearch()
  return template ? <NewFormBuilder key={template} template={template} /> : <ChooseTemplate />
}

/** Where a new form starts: one of a few common forms, or a blank one. */
function ChooseTemplate() {
  return (
    <div className="w-full p-4 lg:p-8">
      <div className="mx-auto w-full max-w-6xl">
      <Link to="/marketing/forms" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Forms
      </Link>
      <h1 className="mb-1.5 text-2xl font-display text-foreground">New form</h1>
      <p className="mb-6 text-muted-foreground">Start from one of these and change anything, or start blank.</p>
      <TemplateTiles />
      </div>
    </div>
  )
}

function NewFormBuilder({ template }: { template: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: listsData } = useQuery({ queryKey: queryKeys.email.lists(), queryFn: () => listsFn() })
  const { data: sendersData } = useQuery({ queryKey: queryKeys.email.senders(), queryFn: () => getSendersFn() })
  const { data: contactFields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })
  const lists = (listsData?.lists ?? []) as Array<{ id: number; name: string }>
  const senders = (sendersData?.senders ?? []) as Array<{ id: number; name: string; email: string }>

  const create = useMutation({
    mutationFn: (draft: Parameters<typeof createFormFn>[0]['data']) => createFormFn({ data: draft }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.forms() })
      // Straight to how to put it on a website.
      navigate({ to: '/marketing/forms/$formId', params: { formId: id }, search: { share: 'new' } })
    },
  })

  const initial = templateDraft(template)
  const from = FORM_TEMPLATES.find((t) => t.id === template)?.name

  return (
    <div className="flex min-h-full flex-col">
      <h1 className="sr-only">New form</h1>
      <FormBuilder
        isNew
        backLabel="Templates"
        onBack={() => navigate({ to: '/marketing/forms/new' })}
        subtitle={from ? `New, from the ${from} template. Change anything you like.` : 'New, from a blank form.'}
        initial={{ ...initial, list_id: lists.some((l) => l.id === initial.list_id) ? initial.list_id : (lists[0]?.id ?? initial.list_id) }}
        lists={lists}
        senders={senders}
        contactFields={contactFields}
        saving={create.isPending}
        error={create.error?.message}
        onSave={(draft) => create.mutate(draft)}
        onCancel={() => navigate({ to: '/marketing/forms/new' })}
      />
    </div>
  )
}
