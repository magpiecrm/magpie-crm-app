import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ClipboardList, Copy, Pencil, Play, Plus, Search, Share2, Square, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { closeSurveyFn, deleteSurveyFn, duplicateSurveyFn, getSurveysFn, publishSurveyFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { ActionMenu } from '../../../components/ui/ActionMenu'
import { Notice } from '../../../components/ui/Notice'
import { confirmDialog } from '../../../components/ui/confirm'
import { toast } from '../../../components/ui/toast'
import { ago } from '../../../features/forms/format'
import { SurveyStatusBadge } from '../../../features/surveys/components/SurveyStatusBadge'
import { SurveyShareDialog } from '../../../features/surveys/components/SurveyShareDialog'
import { StarterTiles } from '../../../features/surveys/components/StarterTiles'
import { HeadlineResult } from '../../../features/surveys/components/HeadlineResult'
import { useCreateSurvey } from '../../../features/surveys/useCreateSurvey'

export const Route = createFileRoute('/marketing/surveys/')({
  component: SurveysPage,
})

type SurveyRow = Awaited<ReturnType<typeof getSurveysFn>>[number]

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

const COLUMNS = 'md:grid-cols-[minmax(0,1fr)_6rem_7.5rem_7.5rem_7rem_8.5rem_6.5rem]'

function SurveysPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [sharing, setSharing] = useState<SurveyRow | null>(null)

  const { data: surveys = [], isLoading } = useQuery({ queryKey: queryKeys.surveys.list(), queryFn: () => getSurveysFn() })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list() })

  const duplicate = useMutation({
    mutationFn: (s: SurveyRow) => duplicateSurveyFn({ data: { id: s.id } }),
    onSuccess: copy => {
      invalidate()
      navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId: copy.id } })
    },
  })
  const setStatus = useMutation({
    mutationFn: ({ s, to }: { s: SurveyRow; to: 'publish' | 'close' }) => (to === 'publish' ? publishSurveyFn({ data: { id: s.id } }) : closeSurveyFn({ data: { id: s.id } })),
    onSuccess: (_, { s, to }) => {
      invalidate()
      toast.success(to === 'publish' ? `“${s.name}” is live` : `“${s.name}” is closed`, { description: to === 'close' ? 'It no longer takes responses. Reopen it any time.' : undefined })
    },
    onError: (err: Error) => toast.error('It can’t go live yet', { description: err.message }),
  })
  const remove = useMutation({
    mutationFn: (s: SurveyRow) => deleteSurveyFn({ data: { id: s.id } }),
    onSuccess: (_, s) => {
      invalidate()
      toast.success(`Deleted “${s.name}”`)
    },
  })
  const confirmDelete = async (s: SurveyRow) => {
    const n = s.responseCount
    const ok = await confirmDialog({
      title: `Delete “${s.name}”?`,
      message: `Its links and embeds stop working${n ? `, and its ${n} response${n === 1 ? '' : 's'} go too` : ''}. Answers already saved to contacts stay. This can't be undone.`,
      confirmLabel: 'Delete survey',
      tone: 'danger',
    })
    if (ok) remove.mutate(s)
  }
  const confirmClose = async (s: SurveyRow) => {
    const ok = await confirmDialog({ title: `Close “${s.name}”?`, message: 'It stops taking responses. You can reopen it later.', confirmLabel: 'Close survey' })
    if (ok) setStatus.mutate({ s, to: 'close' })
  }

  const q = query.trim().toLowerCase()
  const shown = q ? surveys.filter(s => s.name.toLowerCase().includes(q)) : surveys

  return (
    <div className="w-full p-4 lg:p-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="mb-1.5 text-2xl font-display text-foreground">Surveys</h1>
            <p className="text-muted-foreground">Ask your contacts and customers what they think. Send a survey by email, link or QR code, or put it on your site; answers can go onto their contact.</p>
          </div>
          {surveys.length > 0 && (
            <Button leftIcon={<Plus className="h-4 w-4" />} className="max-sm:w-full" onClick={() => navigate({ to: '/marketing/surveys/new' })}>
              New survey
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
        ) : surveys.length === 0 ? (
          <EmptySurveys />
        ) : (
          <>
            {surveys.length > 6 && (
              <div className="relative mb-4 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input className={`${INPUT_CLASS} pl-9`} placeholder="Search surveys" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search surveys" />
              </div>
            )}
            <div className="overflow-hidden rounded-md-m border border-border bg-card">
              <div className={`hidden ${COLUMNS} items-center gap-x-4 border-b border-border bg-muted/40 px-5 py-2.5 text-[13px] font-medium text-muted-foreground md:grid`}>
                <span>Survey</span>
                <span>Status</span>
                <span className="text-right">Responses</span>
                <span className="text-right">Completed</span>
                <span className="text-right">Result</span>
                <span className="whitespace-nowrap pl-4">Latest</span>
                <span className="sr-only">Actions</span>
              </div>
              <ul className="divide-y divide-border/70">
                {shown.map(s => {
                  const rate = s.responseCount ? Math.round((s.completedCount / s.responseCount) * 100) : null
                  return (
                    <li key={s.id} data-survey-row className="group/row relative">
                      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-muted/40 ${COLUMNS} md:items-center`}>
                        <div className="min-w-0">
                          <Link
                            to="/marketing/surveys/$surveyId"
                            params={{ surveyId: s.id }}
                            className="block truncate text-[15px] font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md-s focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/50"
                            title={s.name}
                          >
                            {s.name}
                          </Link>
                          <p className="mt-0.5 text-[13px] text-muted-foreground md:line-clamp-2">
                            {s.questionCount} question{s.questionCount === 1 ? '' : 's'}
                            {s.pageCount > 1 && ` on ${s.pageCount} pages`}
                            {' · '}
                            {s.status === 'draft' ? `Draft, edited ${ago(s.updated_at)}` : s.status === 'closed' ? `Closed ${ago(s.updated_at)}` : s.published_at ? `Live since ${dayFmt.format(new Date(s.published_at))}` : 'Live'}
                          </p>
                          {/* On a phone the numbers go under the name. */}
                          <p className="mt-2 flex items-center justify-between gap-3 text-[13px] text-muted-foreground md:hidden">
                            <SurveyStatusBadge status={s.status} />
                            <span className="truncate text-right">
                              <span className="font-medium tabular-nums text-foreground">{s.responseCount}</span> response{s.responseCount === 1 ? '' : 's'}
                              {s.headline && <> · <HeadlineResult headline={s.headline} inline /></>}
                            </span>
                          </p>
                        </div>
                        <div className="hidden md:block">
                          <SurveyStatusBadge status={s.status} />
                        </div>
                        <div className="hidden text-right md:block">
                          <p className="text-[15px] font-semibold tabular-nums text-foreground">{s.responseCount.toLocaleString('en-GB')}</p>
                          <p className="text-[13px] text-muted-foreground">{s.responsesThisWeek ? `${s.responsesThisWeek} this week` : s.status === 'draft' ? 'Not sent yet' : 'None this week'}</p>
                        </div>
                        <div className="hidden text-right md:block" title="Of the people who started it, how many finished">
                          <p className="text-[15px] font-semibold tabular-nums text-foreground">{rate === null ? '—' : `${rate}%`}</p>
                          <p className="text-[13px] text-muted-foreground">{rate === null ? 'No responses' : `${s.completedCount.toLocaleString('en-GB')} finished`}</p>
                        </div>
                        <div className="hidden text-right md:block">{s.headline ? <HeadlineResult headline={s.headline} /> : <span className="text-[15px] text-muted-foreground">—</span>}</div>
                        <p className="hidden pl-4 text-sm text-muted-foreground md:block">{s.lastResponseAt ? ago(s.lastResponseAt).replace(/^on /, '') : 'None yet'}</p>
                        <div className="relative z-10 flex items-center justify-end gap-1">
                          {/* A draft can't take answers yet, so its quick action is to carry on editing it. */}
                          {s.status === 'draft' ? (
                            <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId: s.id } })} leftIcon={<Pencil className="h-3.5 w-3.5" />} className="max-md:hidden !text-foreground/80">
                              Edit
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => setSharing(s)} leftIcon={<Share2 className="h-3.5 w-3.5" />} className="max-md:hidden !text-foreground/80">
                              Share
                            </Button>
                          )}
                          <ActionMenu
                            label={`Actions for ${s.name}`}
                            items={[
                              { label: 'Edit survey', icon: Pencil, onSelect: () => navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId: s.id } }) },
                              { label: 'Share', icon: Share2, onSelect: () => setSharing(s) },
                              { label: 'Duplicate', icon: Copy, onSelect: () => duplicate.mutate(s) },
                              s.status === 'published'
                                ? { label: 'Close survey', icon: Square, onSelect: () => confirmClose(s) }
                                : { label: s.status === 'closed' ? 'Reopen' : 'Publish', icon: Play, onSelect: () => setStatus.mutate({ s, to: 'publish' }) },
                              'separator',
                              { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => confirmDelete(s) },
                            ]}
                          />
                        </div>
                      </div>
                    </li>
                  )
                })}
                {shown.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">No surveys called “{query.trim()}”.</li>}
              </ul>
            </div>
          </>
        )}

        {sharing && <SurveyShareDialog survey={sharing} onClose={() => setSharing(null)} />}
      </div>
    </div>
  )
}

/** No surveys yet: what they're for, and a few to start from. */
function EmptySurveys() {
  const { pick, pending, error } = useCreateSurvey()
  return (
    <div className="rounded-md-m border border-border bg-card px-5 py-10 sm:px-10 sm:py-14">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ClipboardList className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold text-foreground">Make your first survey</h2>
        <p className="mt-1.5 text-muted-foreground">Measure NPS, ask how onboarding went, or qualify leads. Pick a starting point and change anything you like.</p>
      </div>
      <div className="mx-auto mt-8 max-w-4xl">
        {error && <Notice level="error" className="mb-4">{error}</Notice>}
        <StarterTiles onPick={pick} pending={pending} />
      </div>
    </div>
  )
}
