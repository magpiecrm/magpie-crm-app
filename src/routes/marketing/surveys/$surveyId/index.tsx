import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ArrowLeft, BarChart3, Copy, ExternalLink, Eye, Pencil, Play, Rocket, Share2, Square, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../../queryKeys'
import { closeSurveyFn, deleteSurveyFn, duplicateSurveyFn, getSurveyFn, publishSurveyFn } from '../../../../server/functions'
import { Button } from '../../../../components/ui/Button'
import { ActionMenu } from '../../../../components/ui/ActionMenu'
import { confirmDialog } from '../../../../components/ui/confirm'
import { toast } from '../../../../components/ui/toast'
import { isQuestionType } from '../../../../features/survey-builder/types'
import { SurveyStatusBadge } from '../../../../features/surveys/components/SurveyStatusBadge'
import { SurveyShareDialog } from '../../../../features/surveys/components/SurveyShareDialog'
import { SurveySummary } from '../../../../features/surveys/components/SurveySummary'
import { SurveyResponses } from '../../../../features/surveys/components/SurveyResponses'

type Tab = 'summary' | 'responses'

export const Route = createFileRoute('/marketing/surveys/$surveyId/')({
  validateSearch: (search: Record<string, unknown>): { tab?: 'responses'; share?: 'open' } => ({
    ...(search.tab === 'responses' ? { tab: 'responses' as const } : {}),
    ...(search.share === 'open' ? { share: 'open' as const } : {}),
  }),
  component: SurveyResultsPage,
})

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** One survey: what it is, its results and responses as tabs, and the ways to share or change it. */
function SurveyResultsPage() {
  const { surveyId } = Route.useParams()
  const search = Route.useSearch()
  const tab: Tab = search.tab ?? 'summary'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sharing, setSharing] = useState(false)

  const { data: survey, isLoading, isError } = useQuery({ queryKey: queryKeys.surveys.survey(surveyId), queryFn: () => getSurveyFn({ data: { id: surveyId } }), retry: false })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list() })
  }
  const setStatus = useMutation({
    mutationFn: (to: 'publish' | 'close') => (to === 'publish' ? publishSurveyFn({ data: { id: surveyId } }) : closeSurveyFn({ data: { id: surveyId } })),
    onSuccess: (_, to) => {
      invalidate()
      if (to === 'publish') toast.success('Your survey is live', { description: 'Share its link, embed it, or send it in a campaign.', action: { label: 'Share', onClick: () => setSharing(true) } })
      else toast.success('Survey closed', { description: 'It no longer takes responses. Reopen it any time.' })
    },
    onError: (err: Error) => toast.error('It can’t go live yet', { description: err.message }),
  })
  const duplicate = useMutation({
    mutationFn: () => duplicateSurveyFn({ data: { id: surveyId } }),
    onSuccess: copy => {
      invalidate()
      navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId: copy.id } })
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteSurveyFn({ data: { id: surveyId } }),
    onSuccess: () => {
      invalidate()
      toast.success(`Deleted “${survey?.name}”`)
      navigate({ to: '/marketing/surveys' })
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
  if (isError || !survey) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold text-foreground">This survey doesn't exist any more</h1>
        <p className="mb-5 text-muted-foreground">It may have been deleted.</p>
        <Link to="/marketing/surveys" className="font-medium text-accent hover:underline">
          Back to surveys
        </Link>
      </div>
    )
  }

  const questionCount = survey.design.pages.reduce((n, p) => n + p.blocks.filter(b => isQuestionType(b.type)).length, 0)
  const pages = survey.design.pages.length
  const edit = () => navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId } })
  const publicUrl = `/s/${survey.id}${survey.status === 'draft' ? '?preview=1' : ''}`
  const confirmDelete = async () => {
    const n = survey.responseCount
    const ok = await confirmDialog({
      title: `Delete “${survey.name}”?`,
      message: `Its links and embeds stop working${n ? `, and its ${n} response${n === 1 ? '' : 's'} go too` : ''}. Answers already saved to contacts stay. This can't be undone.`,
      confirmLabel: 'Delete survey',
      tone: 'danger',
    })
    if (ok) remove.mutate()
  }
  const confirmClose = async () => {
    const ok = await confirmDialog({ title: `Close “${survey.name}”?`, message: 'It stops taking responses. People who open its link are told it has closed. You can reopen it later.', confirmLabel: 'Close survey' })
    if (ok) setStatus.mutate('close')
  }

  const tabLink = (to: Tab, label: ReactNode) => {
    const active = tab === to
    return (
      <Link
        to="/marketing/surveys/$surveyId"
        params={{ surveyId }}
        search={to === 'responses' ? { tab: 'responses' } : {}}
        aria-current={active ? 'page' : undefined}
        className={`relative inline-flex min-h-10 items-center gap-2 px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
          active ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
      </Link>
    )
  }

  const empty = (
    <div className="flex flex-col items-center rounded-md-m border border-border bg-card px-6 py-16 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <BarChart3 className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-lg font-semibold text-foreground">No responses yet</h2>
      <p className="mt-1.5 max-w-sm text-muted-foreground">
        {survey.status === 'draft'
          ? 'Publish it, then share its link or send it in a campaign. Results show up here as people answer.'
          : survey.status === 'closed'
            ? "It's closed, so it isn't taking responses. Reopen it to start again."
            : 'Share its link or send it in a campaign. Results show up here as people answer.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {/* The page's own Publish or Reopen is in the header; here, what to do next. */}
        {survey.status === 'published' ? (
          <Button leftIcon={<Share2 className="h-4 w-4" />} onClick={() => setSharing(true)}>
            Share the survey
          </Button>
        ) : (
          <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={edit}>
            Edit survey
          </Button>
        )}
        <Button variant="secondary" leftIcon={<Eye className="h-4 w-4" />} onClick={() => window.open(publicUrl, '_blank', 'noopener')}>
          Try it yourself
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 pt-4 lg:px-8 lg:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <Link to="/marketing/surveys" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Surveys
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-72">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="min-w-0 break-words text-2xl font-display text-foreground">{survey.name}</h1>
                <SurveyStatusBadge status={survey.status} />
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {questionCount} question{questionCount === 1 ? '' : 's'}
                {pages > 1 && ` on ${pages} pages`}
                {' · '}
                {survey.status === 'draft'
                  ? 'Not published yet'
                  : survey.status === 'closed'
                    ? `Closed ${dayFmt.format(new Date(survey.updated_at))}`
                    : survey.published_at
                      ? `Live since ${dayFmt.format(new Date(survey.published_at))}`
                      : 'Live'}
                {survey.settings.identifyContacts && ' · Answers go onto contacts'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {survey.status !== 'draft' && (
                <Button variant="secondary" leftIcon={<Share2 className="h-4 w-4" />} onClick={() => setSharing(true)}>
                  Share
                </Button>
              )}
              <Button variant={survey.status === 'published' ? 'primary' : 'secondary'} leftIcon={<Pencil className="h-4 w-4" />} onClick={edit}>
                Edit survey
              </Button>
              {survey.status !== 'published' && (
                <Button leftIcon={survey.status === 'draft' ? <Rocket className="h-4 w-4" /> : <Play className="h-4 w-4" />} isLoading={setStatus.isPending} onClick={() => setStatus.mutate('publish')}>
                  {survey.status === 'draft' ? 'Publish' : 'Reopen'}
                </Button>
              )}
              <ActionMenu
                label={`More actions for ${survey.name}`}
                triggerClassName="inline-flex h-[38px] w-[38px] cursor-pointer items-center justify-center rounded-md-s border border-control bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.06)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted dark:bg-white/[0.04] dark:shadow-none"
                items={[
                  { label: survey.status === 'draft' ? 'Preview it' : 'Open the survey', icon: ExternalLink, onSelect: () => window.open(publicUrl, '_blank', 'noopener') },
                  { label: 'Duplicate', icon: Copy, onSelect: () => duplicate.mutate() },
                  ...(survey.status === 'published' ? [{ label: 'Close survey', icon: Square, onSelect: confirmClose }] : []),
                  'separator',
                  { label: 'Delete survey', icon: Trash2, tone: 'danger', onSelect: confirmDelete },
                ]}
              />
            </div>
          </div>
          <nav aria-label="Survey" className="mt-4 flex gap-6">
            {tabLink('summary', 'Summary')}
            {tabLink(
              'responses',
              <>
                Responses
                <span className="rounded-full bg-foreground/[0.07] px-1.5 text-xs font-medium tabular-nums text-foreground/80">{survey.responseCount}</span>
              </>,
            )}
          </nav>
        </div>
      </header>

      <div className="w-full p-4 lg:p-8">
        <div className="mx-auto w-full max-w-6xl">{tab === 'summary' ? <SurveySummary survey={survey} empty={empty} /> : <SurveyResponses survey={survey} empty={empty} />}</div>
      </div>

      {(sharing || search.share) && (
        <SurveyShareDialog
          survey={survey}
          onClose={() => {
            setSharing(false)
            if (search.share) navigate({ to: '.', search: tab === 'responses' ? { tab } : {}, replace: true })
          }}
        />
      )}
    </div>
  )
}
