import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, Inbox, Search, Share2, Trash2, UserRound } from 'lucide-react'
import { queryKeys } from '../../../../queryKeys'
import { deleteFormSubmissionFn, getContactFieldsFn, getFormFn, getFormSubmissionsFn } from '../../../../server/functions'
import { Button } from '../../../../components/ui/Button'
import { INPUT_CLASS } from '../../../../components/ui/Field'
import { Dialog, DialogBody, DialogFooter } from '../../../../components/ui/Dialog'
import { ExportMenu } from '../../../../components/ui/ExportMenu'
import { Pagination } from '../../../../components/ui/Pagination'
import { confirmDialog } from '../../../../components/ui/confirm'
import { toast } from '../../../../components/ui/toast'
import { resolveFields, submissionValue, type ResolvedFormField } from '../../../../features/forms/model'
import { ago, exactTime, whenShort } from '../../../../features/forms/format'

export const Route = createFileRoute('/marketing/forms/$formId/')({
  component: SubmissionsPage,
})

type Submission = Awaited<ReturnType<typeof getFormSubmissionsFn>>[number]

const nameOf = (s: Submission) => [submissionValue(s, 'first_name'), submissionValue(s, 'last_name')].filter(Boolean).join(' ')

function SubmissionsPage() {
  const { formId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ by: 'received' | 'person'; dir: 'asc' | 'desc' }>({ by: 'received', dir: 'desc' })

  const { data: form } = useQuery({ queryKey: queryKeys.email.form(formId), queryFn: () => getFormFn({ data: { id: formId } }), retry: false })
  const { data: submissions = [], isLoading } = useQuery({ queryKey: queryKeys.email.formSubmissions(formId), queryFn: () => getFormSubmissionsFn({ data: { formId } }) })
  const { data: contactFields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })

  const fields = useMemo(() => (form ? resolveFields(form, contactFields) : []), [form, contactFields])
  // The table's columns after the person: what else the form asks, the message last as it's the widest.
  const extra = fields.filter((f) => !['first_name', 'last_name', 'email', 'consent'].includes(f.key))
  const columns = [...extra.filter((f) => f.key !== 'message').slice(0, 2), ...extra.filter((f) => f.key === 'message')]

  const remove = useMutation({
    mutationFn: (id: string) => deleteFormSubmissionFn({ data: { formId, id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.formSubmissions(formId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.email.forms() })
      setOpenId(null)
      toast.success('Submission deleted')
    },
  })

  const q = query.trim().toLowerCase()
  const matched = q ? submissions.filter((s) => [nameOf(s), s.contact_email, ...fields.map((f) => submissionValue(s, f.key))].some((v) => v.toLowerCase().includes(q))) : submissions
  const shown = [...matched].sort((a, b) => {
    const d = sort.by === 'received' ? a.submitted_at.localeCompare(b.submitted_at) : (nameOf(a) || a.contact_email).localeCompare(nameOf(b) || b.contact_email, 'en-GB', { sensitivity: 'base' })
    return sort.dir === 'asc' ? d : -d
  })
  const sortBy = (by: 'received' | 'person') => setSort((s) => (s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'received' ? 'desc' : 'asc' }))
  const SortHead = ({ by, label, className = '' }: { by: 'received' | 'person'; label: string; className?: string }) => {
    const active = sort.by === by
    const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-4 py-2.5 font-medium ${className}`}>
        <button type="button" onClick={() => sortBy(by)} className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-md-xs px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {label}
          <Arrow className={`h-3.5 w-3.5 ${active ? 'text-foreground' : 'opacity-0'}`} aria-hidden />
        </button>
      </th>
    )
  }
  const pageRows = shown.slice((page - 1) * perPage, page * perPage)
  const openIndex = openId ? shown.findIndex((s) => s.id === openId) : -1
  const open = openIndex >= 0 ? shown[openIndex] : null

  const exportColumns = useMemo(
    () => [
      ...fields.map((f) => ({ header: f.key === 'consent' ? 'Consent' : f.label, value: (s: Submission) => submissionValue(s, f.key) })),
      { header: 'Received', value: (s: Submission) => exactTime(s.submitted_at) },
    ],
    [fields],
  )

  if (!form) return null
  const week = form.submissions_this_week

  if (!isLoading && submissions.length === 0) {
    return (
      <div className="w-full p-4 lg:p-8"><div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col items-center rounded-md-m border border-border bg-card px-6 py-16 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Inbox className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold text-foreground">No submissions yet</h2>
          <p className="mt-1.5 max-w-sm text-muted-foreground">Put the form on your website or share its link. Everything people send shows up here.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button leftIcon={<Share2 className="h-4 w-4" />} onClick={() => navigate({ to: '.', search: { share: 'open' } })}>Share the form</Button>
            <Button variant="secondary" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(`/f/${formId}`, '_blank', 'noopener')}>
              Try it yourself
            </Button>
          </div>
        </div>
      </div>
      </div>
    )
  }

  return (
    <div className="w-full p-4 lg:p-8"><div className="mx-auto w-full max-w-6xl">
      <dl className="mb-5 grid grid-cols-3 divide-x divide-border/70 overflow-hidden rounded-md-m border border-border bg-card">
        {[
          ['Submissions', form.submission_count.toLocaleString('en-GB')],
          ['This week', week.toLocaleString('en-GB')],
          ['Latest', form.last_submission_at ? ago(form.last_submission_at).replace(/^on /, '') : 'None'],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 px-3.5 py-3 sm:px-5 sm:py-4">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-base font-semibold leading-snug tabular-nums text-foreground sm:text-xl">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            className={`${INPUT_CLASS} pl-9`}
            placeholder="Search submissions"
            aria-label="Search submissions"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <ExportMenu filename={form.name} rows={shown} columns={exportColumns} sheetName="Submissions" className="ml-auto" />
      </div>

      <div className="overflow-hidden rounded-md-m border border-border bg-card">
        {/* A phone gets one card per submission. */}
        <ul className="divide-y divide-border/70 md:hidden">
          {pageRows.map((s) => {
            const name = nameOf(s)
            const message = submissionValue(s, 'message')
            const company = submissionValue(s, 'company')
            return (
              <li key={s.id}>
                <button type="button" onClick={() => setOpenId(s.id)} className="flex w-full cursor-pointer flex-col gap-0.5 px-4 py-3.5 text-left active:bg-muted/50">
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-foreground">{name || s.contact_email}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{whenShort(s.submitted_at)}</span>
                  </span>
                  {name && <span className="break-all text-[13px] text-muted-foreground">{s.contact_email}{company && <> · {company}</>}</span>}
                  {message && <span className="mt-1 line-clamp-2 text-[13px] text-foreground/80">{message}</span>}
                </button>
              </li>
            )
          })}
        </ul>

        <table className="hidden w-full table-fixed text-left text-sm md:table">
          <thead className="border-b border-border bg-muted/40 text-[13px] text-muted-foreground">
            <tr>
              <SortHead by="person" label="Person" className="w-[30%] !pl-5" />
              {columns.map((f) => (
                <th key={f.key} scope="col" className={`px-4 py-2.5 font-medium ${f.key === 'message' ? '' : 'w-[17%]'}`}>{f.label}</th>
              ))}
              <SortHead by="received" label="Received" className="w-[9.5rem]" />
              <th scope="col" className="w-10"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {pageRows.map((s) => {
              const name = nameOf(s)
              return (
                <tr key={s.id} onClick={() => setOpenId(s.id)} className="group cursor-pointer transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 align-top">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenId(s.id)
                      }}
                      className="block max-w-full cursor-pointer truncate text-left font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
                    >
                      {name || s.contact_email}
                    </button>
                    {name && <span className="block truncate text-[13px] text-muted-foreground">{s.contact_email}</span>}
                  </td>
                  {columns.map((f) => <Cell key={f.key} field={f} value={submissionValue(s, f.key)} />)}
                  <td className="whitespace-nowrap px-4 py-3 align-top tabular-nums text-muted-foreground" title={exactTime(s.submitted_at)}>{whenShort(s.submitted_at)}</td>
                  <td className="py-3 pr-4 align-top text-muted-foreground">
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing matches “{query.trim()}”.</p>}
        {shown.length > 25 && (
          <div className="border-t border-border/70 px-4 py-2">
            <Pagination totalItems={shown.length} itemsPerPage={perPage} onItemsPerPageChange={(n) => { setPerPage(n); setPage(1) }} currentPage={page} onPageChange={setPage} itemsPerPageOptions={[25, 50, 100]} />
          </div>
        )}
      </div>

      {open && (
        <SubmissionDialog
          submission={open}
          fields={fields}
          position={`${openIndex + 1} of ${shown.length}`}
          onPrev={openIndex > 0 ? () => setOpenId(shown[openIndex - 1].id) : undefined}
          onNext={openIndex < shown.length - 1 ? () => setOpenId(shown[openIndex + 1].id) : undefined}
          onClose={() => setOpenId(null)}
          onDelete={async () => {
            const ok = await confirmDialog({
              title: 'Delete this submission?',
              message: `What ${nameOf(open) || open.contact_email} sent is removed from this form. Their contact stays. This can't be undone.`,
              confirmLabel: 'Delete submission',
              tone: 'danger',
            })
            if (ok) remove.mutate(open.id)
          }}
          deleting={remove.isPending}
        />
      )}
      </div>
    </div>
  )
}

function Cell({ field, value }: { field: ResolvedFormField; value: string }) {
  if (!value) return <td className="px-4 py-3 align-top text-muted-foreground/60">—</td>
  return (
    <td className="px-4 py-3 align-top text-foreground/85">
      <span className={field.key === 'message' ? 'line-clamp-2' : 'block truncate'} title={value}>{value}</span>
    </td>
  )
}

function SubmissionDialog({
  submission: s,
  fields,
  position,
  onPrev,
  onNext,
  onClose,
  onDelete,
  deleting,
}: {
  submission: Submission
  fields: ResolvedFormField[]
  position: string
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const navigate = useNavigate()
  const name = nameOf(s)
  const hasContact = !!s.contact
  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={name || s.contact_email}
      description={`Received ${exactTime(s.submitted_at)}`}
      className="sm:max-w-lg"
      headerActions={
        <div className="mr-1 flex items-center gap-0.5" aria-label={`Submission ${position}`}>
          <span className="mr-1 hidden text-xs tabular-nums text-muted-foreground sm:inline">{position}</span>
          <Button variant="ghost" size="icon" onClick={onPrev} disabled={!onPrev} aria-label="Previous submission"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onNext} disabled={!onNext} aria-label="Next submission"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      }
    >
      <DialogBody>
        <dl className="divide-y divide-border/70 overflow-hidden rounded-md-s border border-border">
          {fields.map((f) => {
            const value = submissionValue(s, f.key)
            return (
              <div key={f.key} className="grid gap-1 px-3.5 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3">
                <dt className="text-[13px] text-muted-foreground">{f.key === 'consent' ? 'Consent' : f.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {f.key === 'consent' ? (value === 'Yes' ? <>Agreed: “{s.consent_text ?? f.label}”</> : value || <span className="text-muted-foreground">—</span>) : value || <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDelete} isLoading={deleting} leftIcon={<Trash2 className="h-4 w-4" />} className="mr-auto !text-destructive hover:!bg-destructive/10">
          Delete
        </Button>
        {hasContact ? (
          <Button leftIcon={<UserRound className="h-4 w-4" />} onClick={() => navigate({ to: '/marketing/contacts', search: { contact: s.contact_email } })}>
            Open contact
          </Button>
        ) : (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
