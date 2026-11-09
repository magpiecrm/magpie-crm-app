import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, ExternalLink, Pause, Play, Share2, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { deleteFormFn, duplicateFormFn, getContactFieldsFn, getFormFn, listsFn, setFormPausedFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { ActionMenu } from '../../../components/ui/ActionMenu'
import { confirmDialog } from '../../../components/ui/confirm'
import { toast } from '../../../components/ui/toast'
import { ShareDialog } from '../../../features/forms/components/ShareDialog'
import { FormStatus } from '../../../features/forms/components/FormStatus'
import { publicForm } from '../../../features/forms/model'
import { delayLabel } from '../../../features/forms/format'

export const Route = createFileRoute('/marketing/forms/$formId')({
  // `share=new` straight after a form is made, to show how to put it on a website.
  validateSearch: (search: Record<string, unknown>): { share?: 'new' | 'open' } =>
    search.share === 'new' || search.share === 'open' ? { share: search.share } : {},
  component: FormPage,
})

/** One form: what it is and does, its submissions, and the builder, as tabs. */
function FormPage() {
  const { formId } = Route.useParams()
  const { share } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const editing = path.endsWith('/edit')
  const [sharing, setSharing] = useState(false)

  const { data: form, isLoading, isError } = useQuery({ queryKey: queryKeys.email.form(formId), queryFn: () => getFormFn({ data: { id: formId } }), retry: false })
  const { data: listsData } = useQuery({ queryKey: queryKeys.email.lists(), queryFn: () => listsFn() })
  const { data: contactFields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })
  const lists = (listsData?.lists ?? []) as Array<{ id: number; name: string }>

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.email.forms() })
  }
  const pause = useMutation({
    mutationFn: () => setFormPausedFn({ data: { id: formId, paused: !form?.paused } }),
    onSuccess: () => {
      invalidate()
      toast.success(form?.paused ? 'Taking submissions again' : 'Paused', { description: form?.paused ? undefined : "It stays on your site, but won't take submissions." })
    },
  })
  const duplicate = useMutation({
    mutationFn: () => duplicateFormFn({ data: { id: formId } }),
    onSuccess: ({ id }) => {
      invalidate()
      navigate({ to: '/marketing/forms/$formId/edit', params: { formId: id } })
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteFormFn({ data: { id: formId } }),
    onSuccess: () => {
      invalidate()
      toast.success(`Deleted “${form?.name}”`)
      navigate({ to: '/marketing/forms' })
    },
  })

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-8" aria-busy="true">
        <div className="mb-3 h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="mb-6 h-8 w-72 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-md-m bg-muted" />
      </div>
    )
  }
  if (isError || !form) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold text-foreground">This form doesn't exist any more</h1>
        <p className="mb-5 text-muted-foreground">It may have been deleted.</p>
        <Link to="/marketing/forms" className="font-medium text-accent hover:underline">Back to forms</Link>
      </div>
    )
  }

  const list = form.save_to_list_enabled === false ? null : lists.find((l) => l.id === form.list_id)
  const confirmDelete = async () => {
    const n = form.submission_count
    const ok = await confirmDialog({
      title: `Delete “${form.name}”?`,
      message: `It stops working wherever it's embedded${n ? `, and its ${n} submission${n === 1 ? '' : 's'} go too` : ''}. Contacts it added stay. This can't be undone.`,
      confirmLabel: 'Delete form',
      tone: 'danger',
    })
    if (ok) remove.mutate()
  }
  const closeShare = () => {
    setSharing(false)
    if (share) navigate({ to: '.', search: {}, replace: true })
  }

  const tab = (to: 'submissions' | 'edit', label: ReactNode) => {
    const active = to === 'edit' ? editing : !editing
    return (
      <Link
        to={to === 'edit' ? '/marketing/forms/$formId/edit' : '/marketing/forms/$formId'}
        params={{ formId }}
        aria-current={active ? 'page' : undefined}
        className={`relative inline-flex min-h-10 items-center gap-2 px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
          active ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
      </Link>
    )
  }

  // The editor brings its own bar (name, status, save), so the page's header and tabs step aside.
  if (editing) {
    return (
      <div className="flex min-h-full flex-col">
        <Outlet />
        {(sharing || share) && <ShareDialog form={publicForm(form, contactFields)} ready={share === 'new'} onClose={closeShare} />}
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      {form.paused && (
        <div className="border-b border-amber-500/30 bg-amber-500/[0.08] px-4 py-2.5 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
            <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-foreground">
              <Pause className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
              <span><span className="font-semibold">Paused.</span> It still shows on your site, but won't take submissions.</span>
            </p>
            <Button size="sm" variant="secondary" leftIcon={<Play className="h-3.5 w-3.5" />} onClick={() => pause.mutate()} isLoading={pause.isPending}>
              Resume
            </Button>
          </div>
        </div>
      )}
      <header className="border-b border-border px-4 pt-4 lg:px-8 lg:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <Link to="/marketing/forms" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Forms
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-72">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="min-w-0 break-words text-2xl font-display text-foreground">{form.name}</h1>
                <FormStatus paused={!!form.paused} />
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {list ? <>Adds people to <span className="font-medium text-foreground">{list.name}</span></> : 'Not added to a list'}
                {' · '}
                {form.welcome_email_enabled ? `Welcome email ${form.welcome_email_delay_minutes ? `after ${delayLabel(form.welcome_email_delay_minutes)}` : 'straight away'}` : 'No welcome email'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" leftIcon={<Share2 className="h-4 w-4" />} onClick={() => setSharing(true)}>
                Share
              </Button>
              <ActionMenu
                label={`More actions for ${form.name}`}
                triggerClassName="inline-flex h-[38px] w-[38px] cursor-pointer items-center justify-center rounded-md-s border border-control bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.06)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted dark:bg-white/[0.04] dark:shadow-none"
                items={[
                  { label: "Open the form's page", icon: ExternalLink, onSelect: () => window.open(`/f/${form.id}`, '_blank', 'noopener') },
                  { label: 'Duplicate', icon: Copy, onSelect: () => duplicate.mutate() },
                  { label: form.paused ? 'Resume' : 'Pause', icon: form.paused ? Play : Pause, onSelect: () => pause.mutate() },
                  'separator',
                  { label: 'Delete form', icon: Trash2, tone: 'danger', onSelect: confirmDelete },
                ]}
              />
            </div>
          </div>
          <nav aria-label="Form" className="mt-4 flex gap-6">
            {tab(
              'submissions',
              <>
                Submissions
                <span className="rounded-full bg-foreground/[0.07] px-1.5 text-xs font-medium tabular-nums text-foreground/80">{form.submission_count}</span>
              </>,
            )}
            {tab('edit', 'Edit form')}
          </nav>
        </div>
      </header>

      <Outlet />

      {(sharing || share) && <ShareDialog form={publicForm(form, contactFields)} ready={share === 'new'} onClose={closeShare} />}
    </div>
  )
}
