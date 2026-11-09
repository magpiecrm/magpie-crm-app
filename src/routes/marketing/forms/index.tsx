import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ChevronRight, Copy, FileText, Pause, Pencil, Play, Plus, Search, Share2, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { deleteFormFn, duplicateFormFn, getContactFieldsFn, getFormsFn, listsFn, setFormPausedFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { ActionMenu } from '../../../components/ui/ActionMenu'
import { confirmDialog } from '../../../components/ui/confirm'
import { toast } from '../../../components/ui/toast'
import { ShareDialog } from '../../../features/forms/components/ShareDialog'
import { FormStatus } from '../../../features/forms/components/FormStatus'
import { FORM_TEMPLATES } from '../../../features/forms/templates'
import { publicForm, type FormRecord } from '../../../features/forms/model'
import { ago } from '../../../features/forms/format'

export const Route = createFileRoute('/marketing/forms/')({
  component: FormsPage,
})

type FormRow = Awaited<ReturnType<typeof getFormsFn>>[number]

function FormsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sharing, setSharing] = useState<FormRow | null>(null)
  const [query, setQuery] = useState('')

  const { data: forms = [], isLoading } = useQuery({ queryKey: queryKeys.email.forms(), queryFn: () => getFormsFn() })
  const { data: listsData } = useQuery({ queryKey: queryKeys.email.lists(), queryFn: () => listsFn() })
  const { data: contactFields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })
  const lists = (listsData?.lists ?? []) as Array<{ id: number; name: string }>

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.email.forms() })
  const pause = useMutation({
    mutationFn: (f: FormRow) => setFormPausedFn({ data: { id: f.id, paused: !f.paused } }),
    onSuccess: (_, f) => {
      invalidate()
      toast.success(f.paused ? `“${f.name}” is taking submissions again` : `“${f.name}” is paused`)
    },
  })
  const duplicate = useMutation({
    mutationFn: (f: FormRow) => duplicateFormFn({ data: { id: f.id } }),
    onSuccess: ({ id }) => {
      invalidate()
      navigate({ to: '/marketing/forms/$formId/edit', params: { formId: id } })
    },
  })
  const remove = useMutation({
    mutationFn: (f: FormRow) => deleteFormFn({ data: { id: f.id } }),
    onSuccess: (_, f) => {
      invalidate()
      toast.success(`Deleted “${f.name}”`)
    },
  })
  const confirmDelete = async (f: FormRow) => {
    const n = f.submission_count
    const ok = await confirmDialog({
      title: `Delete “${f.name}”?`,
      message: `It stops working wherever it's embedded${n ? `, and its ${n} submission${n === 1 ? '' : 's'} go too` : ''}. Contacts it added stay. This can't be undone.`,
      confirmLabel: 'Delete form',
      tone: 'danger',
    })
    if (ok) remove.mutate(f)
  }

  const listName = (f: FormRow) => (f.save_to_list_enabled === false ? null : lists.find((l) => l.id === f.list_id)?.name ?? 'a list')
  const shown = query.trim() ? forms.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase())) : forms

  return (
    <div className="mx-auto w-full max-w-6xl p-4 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="mb-1.5 text-2xl font-display text-foreground">Forms</h1>
          <p className="text-muted-foreground">Sign-up and contact forms for your website. Everyone who sends one can be added to a list and sent a welcome email.</p>
        </div>
        {forms.length > 0 && (
          <Button leftIcon={<Plus className="h-4 w-4" />} className="max-sm:w-full" onClick={() => navigate({ to: '/marketing/forms/new' })}>
            New form
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="overflow-hidden rounded-md-m border border-border bg-card" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border/70 px-5 py-4 last:border-0">
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : forms.length === 0 ? (
        <EmptyForms />
      ) : (
        <>
          {forms.length > 6 && (
            <div className="relative mb-4 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input className={`${INPUT_CLASS} pl-9`} placeholder="Search forms" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search forms" />
            </div>
          )}
          <div className="overflow-hidden rounded-md-m border border-border bg-card">
            {/* Column heads, where the rows are a table. */}
            <div className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_10rem_6.5rem] items-center gap-4 border-b border-border bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
              <span>Form</span>
              <span>Status</span>
              <span className="text-right">Submissions</span>
              <span>Last submission</span>
              <span className="sr-only">Actions</span>
            </div>
            <ul className="divide-y divide-border/70">
              {shown.map((f) => {
                const list = listName(f)
                return (
                  <li key={f.id} data-form-card className="group/row relative">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_7rem_9rem_10rem_6.5rem]">
                      <div className="min-w-0">
                        <Link
                          to="/marketing/forms/$formId"
                          params={{ formId: f.id }}
                          className="block truncate text-[15px] font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md-s focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/50"
                        >
                          {f.name}
                        </Link>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {f.fields.length} field{f.fields.length === 1 ? '' : 's'} · {list ? <>Adds people to {list}</> : 'Not added to a list'}
                          {f.welcome_email_enabled && ' · Welcome email'}
                        </p>
                        {/* On a phone the numbers go under the name. */}
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground md:hidden">
                          <FormStatus paused={!!f.paused} />
                          <span>
                            <span className="font-medium tabular-nums text-foreground">{f.submission_count}</span> submission{f.submission_count === 1 ? '' : 's'}
                          </span>
                          {f.last_submission_at && <span>· last {ago(f.last_submission_at)}</span>}
                        </p>
                      </div>
                      <div className="hidden md:block">
                        <FormStatus paused={!!f.paused} />
                      </div>
                      <div className="hidden text-right md:block">
                        <p className="text-[15px] font-semibold tabular-nums text-foreground">{f.submission_count.toLocaleString('en-GB')}</p>
                        <p className="text-xs text-muted-foreground">{f.submissions_this_week ? `${f.submissions_this_week} this week` : 'None this week'}</p>
                      </div>
                      <p className="hidden text-sm text-muted-foreground md:block">{f.last_submission_at ? ago(f.last_submission_at).replace(/^on /, '') : 'None yet'}</p>
                      <div className="relative z-10 flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setSharing(f)} leftIcon={<Share2 className="h-3.5 w-3.5" />} className="max-md:hidden text-foreground/80">
                          Share
                        </Button>
                        <ActionMenu
                          label={`Actions for ${f.name}`}
                          items={[
                            { label: 'Edit form', icon: Pencil, onSelect: () => navigate({ to: '/marketing/forms/$formId/edit', params: { formId: f.id } }) },
                            { label: 'Share', icon: Share2, onSelect: () => setSharing(f) },
                            { label: 'Duplicate', icon: Copy, onSelect: () => duplicate.mutate(f) },
                            { label: f.paused ? 'Resume' : 'Pause', icon: f.paused ? Play : Pause, onSelect: () => pause.mutate(f) },
                            'separator',
                            { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => confirmDelete(f) },
                          ]}
                        />
                      </div>
                    </div>
                  </li>
                )
              })}
              {shown.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">No forms called “{query.trim()}”.</li>}
            </ul>
          </div>
        </>
      )}

      {sharing && <ShareDialog form={publicForm(sharing as FormRecord, contactFields)} onClose={() => setSharing(null)} />}
    </div>
  )
}

/** No forms yet: what they're for, and a few to start from. */
function EmptyForms() {
  return (
    <div className="rounded-md-m border border-border bg-card px-5 py-10 sm:px-10 sm:py-14">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <FileText className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold text-foreground">Make your first form</h2>
        <p className="mt-1.5 text-muted-foreground">Put it on your website or share its link. Everyone who sends it becomes a contact you can email.</p>
      </div>
      <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
        {FORM_TEMPLATES.map((t) => (
          <Link
            key={t.id}
            to="/marketing/forms/new"
            search={{ template: t.id }}
            className="group flex items-start gap-3 rounded-md-s border border-border bg-background px-4 py-3.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md-xs bg-muted text-foreground/75">
              <t.icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{t.name}</span>
              <span className="block text-[13px] text-muted-foreground">{t.description}</span>
            </span>
            <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
      </div>
      <div className="mt-5 text-center">
        <Link to="/marketing/forms/new" search={{ template: 'blank' }} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <Plus className="h-4 w-4" aria-hidden /> Start from a blank form
        </Link>
      </div>
    </div>
  )
}
