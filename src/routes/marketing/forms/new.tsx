import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createFormFn, getContactFieldsFn, getSendersFn, listsFn } from '../../../server/functions'
import { FormBuilder } from '../../../features/forms/components/FormBuilder'
import { FORM_TEMPLATES, templateDraft } from '../../../features/forms/templates'

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
    <div className="mx-auto w-full max-w-3xl p-4 lg:p-8">
      <Link to="/marketing/forms" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Forms
      </Link>
      <h1 className="mb-1.5 text-2xl font-display text-foreground">New form</h1>
      <p className="mb-6 text-muted-foreground">Start from one of these and change anything, or start blank.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FORM_TEMPLATES.map((t) => (
          <Link
            key={t.id}
            to="/marketing/forms/new"
            search={{ template: t.id }}
            className="group flex items-start gap-3 rounded-md-m border border-border bg-card px-4 py-4 transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md-s bg-muted text-foreground/75">
              <t.icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-foreground">{t.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{t.description}</span>
            </span>
            <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
        <Link
          to="/marketing/forms/new"
          search={{ template: 'blank' }}
          className="group flex items-start gap-3 rounded-md-m border border-dashed border-border px-4 py-4 transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:col-span-2"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md-s border border-border text-foreground/75">
            <Plus className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-foreground">Blank form</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">Name, email and a message, to build on.</span>
          </span>
        </Link>
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
  const name = template === 'blank' ? 'New form' : `New form: ${FORM_TEMPLATES.find((t) => t.id === template)?.name ?? 'Blank'}`

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pt-4 lg:px-8 lg:pt-8">
        <Link to="/marketing/forms/new" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Choose another
        </Link>
        <h1 className="text-2xl font-display text-foreground">{name}</h1>
      </div>
      <FormBuilder
        isNew
        initial={{ ...initial, list_id: lists.some((l) => l.id === initial.list_id) ? initial.list_id : (lists[0]?.id ?? initial.list_id) }}
        lists={lists}
        senders={senders}
        contactFields={contactFields}
        saving={create.isPending}
        error={create.error?.message}
        onSave={(draft) => create.mutate(draft)}
        onCancel={() => navigate({ to: '/marketing/forms' })}
      />
    </div>
  )
}
