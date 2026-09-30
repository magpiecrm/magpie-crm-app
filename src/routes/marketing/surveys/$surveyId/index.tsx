import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Pencil, Rocket, Square, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../../queryKeys'
import {
  closeSurveyFn,
  deleteSurveyResponseFn,
  getSurveyFn,
  getSurveyResponsesFn,
  getSurveySummaryFn,
  publishSurveyFn,
} from '../../../../server/functions'
import { Dialog } from '../../../../components/ui/Dialog'
import { Badge } from '../../../../components/ui/Badge'
import { ExportMenu } from '../../../../components/ui/ExportMenu'
import type { ExportColumn } from '../../../../utils/export'
import type { QuestionSummary } from '../../../../features/survey-builder/analytics'
import type { Survey, SurveyBlock } from '../../../../features/survey-builder/types'
import { isQuestionType } from '../../../../features/survey-builder/types'
import { answerToDisplay } from '../../../../features/survey-builder/logic/answers'
import { SurveyStatusBadge } from '../../../../features/surveys/components/SurveyStatusBadge'
import { SharePanel } from '../../../../features/surveys/components/SharePanel'
import { BarList, Distribution, NpsSplit, npsBand } from '../../../../features/surveys/components/charts'
import { Select } from '../../../../components/ui/Select'

export const Route = createFileRoute('/marketing/surveys/$surveyId/')({
  component: SurveyResultsPage,
})

const SOURCE_LABELS: Record<string, string> = { email: 'Email link', email_inline: 'Answered in email', link: 'Public link', embed: 'Website embed', qr: 'QR code' }

type ResponseRow = Awaited<ReturnType<typeof getSurveyResponsesFn>>[number]

function SurveyResultsPage() {
  const { surveyId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'summary' | 'responses' | 'share'>('summary')

  const { data: survey, isLoading, error } = useQuery({
    queryKey: queryKeys.surveys.survey(surveyId),
    queryFn: () => getSurveyFn({ data: { id: surveyId } }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list() })
  const statusMutation = useMutation({
    mutationFn: (action: 'publish' | 'close') =>
      action === 'publish' ? publishSurveyFn({ data: { id: surveyId } }) : closeSurveyFn({ data: { id: surveyId } }),
    onSuccess: invalidate,
  })

  if (isLoading) return <div className="p-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (error || !survey) return <div className="p-8 text-destructive">{error?.message ?? 'Survey not found'}</div>

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/marketing/surveys" className="p-2 rounded-md-s hover:bg-muted text-muted-foreground" aria-label="Back to surveys">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-display text-foreground truncate">{survey.name}</h1>
              <SurveyStatusBadge status={survey.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {survey.design.pages.length} page(s) · created {new Date(survey.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId } })}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md-s border border-border hover:bg-muted cursor-pointer"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
          {survey.status === 'published' ? (
            <button
              onClick={() => confirm('Close this survey? It will stop accepting responses.') && statusMutation.mutate('close')}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-md-s border border-border hover:bg-muted cursor-pointer"
            >
              <Square className="w-4 h-4" /> Close
            </button>
          ) : (
            <button
              onClick={() => statusMutation.mutate('publish')}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-md-s bg-primary text-primary-foreground font-medium hover:bg-primary/85 cursor-pointer"
            >
              <Rocket className="w-4 h-4" /> {survey.status === 'closed' ? 'Reopen' : 'Publish'}
            </button>
          )}
        </div>
      </div>
      {statusMutation.error && <p className="text-sm text-destructive whitespace-pre-line">{statusMutation.error.message}</p>}

      <div className="flex border-b border-border">
        {(['summary', 'responses', 'share'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 capitalize cursor-pointer ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'summary' && <SummaryTab surveyId={surveyId} />}
      {tab === 'responses' && <ResponsesTab survey={survey} />}
      {tab === 'share' && <SharePanel surveyId={surveyId} status={survey.status} name={survey.name} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card border border-border rounded-md-m p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold text-foreground tabular-nums mt-1">{value}</div>
    </div>
  )
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function SummaryTab({ surveyId }: { surveyId: string }) {
  const { data: summary, isLoading } = useQuery({
    queryKey: queryKeys.surveys.summary(surveyId),
    queryFn: () => getSurveySummaryFn({ data: { id: surveyId } }),
  })
  if (isLoading || !summary) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />

  if (summary.started === 0) {
    return <p className="text-sm text-muted-foreground py-12 text-center">No responses yet. Share the survey from the Share tab.</p>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Started" value={summary.started} />
        <Stat label="Completed" value={summary.completed} />
        <Stat label="Completion rate" value={summary.completionRate === null ? '—' : `${summary.completionRate}%`} />
        <Stat label="Median time" value={formatDuration(summary.medianSeconds)} />
      </div>

      {summary.pageReach.length > 1 && (
        <div className="card border border-border rounded-md-m p-5 space-y-3">
          <h3 className="font-medium text-foreground">Page drop-off</h3>
          <BarList rows={summary.pageReach.map(p => ({ label: p.title, count: p.reached }))} total={summary.started} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {summary.questions.map(q => (
          <QuestionCard key={q.id} q={q} />
        ))}
      </div>
    </div>
  )
}

function QuestionCard({ q }: { q: QuestionSummary }) {
  const [search, setSearch] = useState('')
  return (
    <div className="card border border-border rounded-md-m p-5 space-y-4">
      <div>
        <h3 className="font-medium text-foreground">{q.title}</h3>
        <p className="text-xs text-muted-foreground">{q.answered} answer{q.answered !== 1 ? 's' : ''}</p>
      </div>

      {q.kind === 'choice' && (
        <>
          <BarList rows={[...q.options.map(o => ({ label: o.label, count: o.count })), ...(q.other.length ? [{ label: 'Other', count: q.other.length }] : [])]} total={q.answered} />
          {q.other.length > 0 && <p className="text-xs text-muted-foreground">Other: {q.other.slice(-5).join(' · ')}</p>}
        </>
      )}

      {q.kind === 'nps' && (
        <>
          <div className="text-3xl font-semibold text-foreground tabular-nums">
            {q.score ?? '—'} <span className="text-sm font-normal text-muted-foreground">NPS</span>
          </div>
          <NpsSplit detractors={q.detractors} passives={q.passives} promoters={q.promoters} />
          <Distribution counts={q.distribution} start={0} colorFor={npsBand} />
        </>
      )}

      {q.kind === 'scale' && (
        <>
          <div className="text-3xl font-semibold text-foreground tabular-nums">
            {q.average ?? '—'} <span className="text-sm font-normal text-muted-foreground">average</span>
          </div>
          <Distribution counts={q.distribution} start={q.min} />
        </>
      )}

      {q.kind === 'yes_no' && <BarList rows={[{ label: 'Yes', count: q.yes }, { label: 'No', count: q.no }]} total={q.answered} />}

      {q.kind === 'number' && (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Stat label="Average" value={q.average ?? '—'} />
          <Stat label="Min" value={q.min ?? '—'} />
          <Stat label="Max" value={q.max ?? '—'} />
        </div>
      )}

      {q.kind === 'text' && (
        <div className="space-y-2">
          {q.latest.length > 5 && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search answers"
              className="w-full text-sm bg-background border border-border rounded-md-s px-3 py-1.5"
            />
          )}
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {q.latest
              .filter(a => !search || a.value.toLowerCase().includes(search.toLowerCase()))
              .map((a, i) => (
                <li key={i} className="text-sm border-l-2 border-border pl-3">
                  <p className="text-foreground whitespace-pre-wrap">{a.value}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.email ?? 'Anonymous'} · {new Date(a.at).toLocaleDateString()}
                  </p>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ResponsesTab({ survey }: { survey: Survey }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'' | 'partial' | 'completed'>('')
  const [source, setSource] = useState('')
  const [open, setOpen] = useState<ResponseRow | null>(null)
  const filters = { status: status || undefined, source: source || undefined }

  const { data: responses = [], isLoading } = useQuery({
    queryKey: queryKeys.surveys.responses(survey.id, filters),
    queryFn: () => getSurveyResponsesFn({ data: { id: survey.id, ...filters } }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSurveyResponseFn({ data: { id } }),
    onSuccess: () => {
      setOpen(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.surveys.survey(survey.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list(), exact: true })
    },
  })

  const questions = useMemo(
    () => survey.design.pages.flatMap(p => p.blocks.filter(b => isQuestionType(b.type))) as SurveyBlock[],
    [survey.design],
  )

  const columns = useMemo<ExportColumn<ResponseRow>[]>(
    () => [
      { header: 'Email', value: r => r.contact_email ?? '' },
      { header: 'Status', value: r => r.status },
      { header: 'Source', value: r => SOURCE_LABELS[r.source] ?? r.source },
      { header: 'Campaign', value: r => r.campaignName ?? '' },
      { header: 'Started', value: r => r.started_at },
      { header: 'Completed', value: r => r.completed_at ?? '' },
      ...questions.map(q => ({ header: q.question?.title || q.id, value: (r: ResponseRow) => answerToDisplay(q, r.answers[q.id]) })),
    ],
    [questions],
  )

  const selectClass = 'text-sm bg-background border border-border rounded-md-s px-3 py-1.5'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={e => setStatus(e.target.value as typeof status)} className={selectClass}>
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="partial">Partial</option>
        </Select>
        <Select value={source} onChange={e => setSource(e.target.value)} className={selectClass}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">{responses.length} response(s)</span>
        <div className="ml-auto">
          <ExportMenu filename={`survey-${survey.name}`} rows={responses} columns={columns} sheetName="Responses" />
        </div>
      </div>

      <div className="card border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left font-medium px-4 py-2">Respondent</th>
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-left font-medium px-4 py-2">Source</th>
              <th className="text-left font-medium px-4 py-2">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-muted-foreground">Loading…</td>
              </tr>
            ) : responses.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-muted-foreground">No responses match.</td>
              </tr>
            ) : (
              responses.map(r => (
                <tr key={r.id} onClick={() => setOpen(r)} className="hover:bg-muted/40 cursor-pointer">
                  <td className="px-4 py-2 text-foreground">{r.contact_email ?? <span className="text-muted-foreground">Anonymous</span>}</td>
                  <td className="px-4 py-2">
                    <Badge variant={r.status === 'completed' ? 'success' : 'default'}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {SOURCE_LABELS[r.source] ?? r.source}
                    {r.campaignName && ` · ${r.campaignName}`}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(r.updated_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog isOpen={!!open} onClose={() => setOpen(null)} title={open?.contact_email ?? 'Anonymous response'} className="max-w-2xl">
        {open && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABELS[open.source]} · started {new Date(open.started_at).toLocaleString()}
              {open.completed_at && ` · completed ${new Date(open.completed_at).toLocaleString()}`}
            </p>
            <dl className="space-y-3">
              {questions.map(q => (
                <div key={q.id}>
                  <dt className="text-xs font-medium text-muted-foreground">{q.question?.title}</dt>
                  <dd className="text-sm text-foreground whitespace-pre-wrap">
                    {answerToDisplay(q, open.answers[q.id]) || <span className="text-muted-foreground">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex justify-end">
              <button
                onClick={() => confirm('Delete this response?') && deleteMutation.mutate(open.id)}
                className="flex items-center gap-2 text-sm text-destructive hover:bg-destructive/10 px-3 py-1.5 rounded-md-s cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> Delete response
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
