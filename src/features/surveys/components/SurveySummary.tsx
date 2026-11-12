import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownWideNarrow, BarChart3, CornerDownRight, Search, Table2, TrendingUp } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getSurveySummaryFn } from '../../../server/functions'
import { Select } from '../../../components/ui/Select'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'
import type { QuestionSummary } from '../../survey-builder/analytics'
import type { Survey, SurveyBlock } from '../../survey-builder/types'
import { isQuestionType, SURVEY_BLOCK_TYPES } from '../../survey-builder/types'
import { BlockChip } from '../../survey-builder/blockIcons'
import { ago, whenShort } from '../../forms/format'
import { BAR, BarList, Distribution, NpsSummary, NpsTrend, TRACK, npsBand } from './charts'
import { SOURCE_LABELS } from '../sources'
import { AnswerFilterSelect } from './AnswerFilterSelect'
import type { AnswerFilter } from '../../survey-builder/logic/answerFilter'

export type Range = 'all' | '7' | '30' | '90'

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/** One survey's results: filters, the headline numbers, where people stopped, and every question in order. */
export function SurveySummary({ survey, empty }: { survey: Survey; empty: React.ReactNode }) {
  const [range, setRange] = useState<Range>('all')
  const [source, setSource] = useState('')
  const [answer, setAnswer] = useState<AnswerFilter | null>(null)
  const filters = { days: range === 'all' ? undefined : Number(range), source: source || undefined, answer: answer ?? undefined }
  const { data: summary, isLoading } = useQuery({
    queryKey: queryKeys.surveys.summary(survey.id, filters),
    queryFn: () => getSurveySummaryFn({ data: { id: survey.id, ...filters } }),
    placeholderData: prev => prev,
  })
  const blocks = useMemo(() => {
    const byId = new Map<string, { block: SurveyBlock; n: number }>()
    let n = 0
    for (const p of survey.design.pages) for (const b of p.blocks) if (isQuestionType(b.type)) byId.set(b.id, { block: b, n: ++n })
    return byId
  }, [survey.design])

  if (isLoading || !summary) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-24 animate-pulse rounded-md-m bg-muted" />
        <div className="h-64 animate-pulse rounded-md-m bg-muted" />
      </div>
    )
  }
  if (summary.total === 0) return <>{empty}</>

  const filtered = range !== 'all' || !!source || !!answer
  const multiPage = summary.pageReach.length > 1

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select className={`${INPUT_CLASS} !w-auto min-w-[9.5rem]`} value={range} onChange={e => setRange(e.target.value as Range)} aria-label="When">
          <option value="all">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
        {summary.sources.length > 1 && (
          <Select className={`${INPUT_CLASS} !w-auto min-w-[10.5rem]`} value={source} onChange={e => setSource(e.target.value)} aria-label="Where from">
            <option value="">From anywhere</option>
            {summary.sources.map(s => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s] ?? s}
              </option>
            ))}
          </Select>
        )}
        <AnswerFilterSelect design={survey.design} value={answer} onChange={setAnswer} />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => (setRange('all'), setSource(''), setAnswer(null))}>
            Clear
          </Button>
        )}
        {filtered && (
          <span className="text-[13px] text-muted-foreground sm:ml-auto">
            {summary.started} of {summary.total} responses
          </span>
        )}
      </div>

      {summary.started === 0 ? (
        <p className="rounded-md-m border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">No responses match. Try a longer time or another source.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 divide-border/70 overflow-hidden rounded-md-m border border-border bg-card max-sm:[&>div:nth-child(-n+2)]:border-b max-sm:[&>div:nth-child(odd)]:border-r sm:grid-cols-4 sm:divide-x">
            {[
              ['Responses', summary.started.toLocaleString('en-GB'), `${summary.thisWeek.toLocaleString('en-GB')} this week`],
              ['Finished', summary.completed.toLocaleString('en-GB'), summary.completionRate === null ? '' : `${summary.completionRate}% of those who started`],
              ['Median time', formatDuration(summary.medianSeconds), 'to finish'],
              ['Latest', summary.latestAt ? ago(summary.latestAt).replace(/^on /, '') : '—', summary.latestAt ? whenShort(summary.latestAt) : ''],
            ].map(([label, value, sub]) => (
              <div key={label} className="min-w-0 px-3.5 py-3 sm:px-5 sm:py-4">
                <dt className="text-[13px] text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold leading-snug tabular-nums text-foreground sm:text-xl">{value}</dd>
                {sub && <dd className="mt-0.5 text-[13px] text-muted-foreground max-sm:hidden">{sub}</dd>}
              </div>
            ))}
          </dl>

          {multiPage && (
            <section className="rounded-md-m border border-border bg-card px-5 py-4" aria-labelledby="stopped-heading">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="stopped-heading" className="text-[15px] font-semibold text-foreground">
                  Pages
                </h2>
                <p className="text-[13px] text-muted-foreground">How many reached each page, and how many stopped there without finishing.</p>
              </div>
              <ul className="divide-y divide-border/70">
                {summary.pageReach.map((p, i) => (
                  <li key={p.pageId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7rem_8rem]">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                        {p.branch && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                        <span className="truncate">
                          {i + 1}. {p.title}
                        </span>
                      </span>
                      {p.branch && <span className="block text-[13px] text-muted-foreground">Only when logic sends people here</span>}
                    </span>
                    <span className={`h-3 overflow-hidden rounded-r-[4px] ${TRACK} max-sm:order-last max-sm:col-span-2`}>
                      <span className={`block h-full rounded-r-[4px] ${BAR}`} style={{ width: `${(p.reached / Math.max(1, summary.started)) * 100}%`, minWidth: p.reached ? 4 : 0 }} />
                    </span>
                    <span className="text-right text-sm tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{p.reached}</span> reached
                    </span>
                    <span className={`text-right text-sm tabular-nums max-sm:hidden ${p.stopped ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {p.stopped ? (
                        <>
                          <span className="font-semibold">{p.stopped}</span> stopped here
                        </>
                      ) : (
                        'None stopped'
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-col gap-4">
            {summary.questions.map(q => {
              const info = blocks.get(q.id)
              return info ? <QuestionCard key={q.id} q={q} block={info.block} n={info.n} started={summary.started} /> : null
            })}
          </div>
        </>
      )}
    </div>
  )
}

type View = 'chart' | 'weeks' | 'table'

/** A question's results as rows of a plain table: the same numbers as its chart, for reading out or copying. */
function ResultTable({ rows, total }: { rows: Array<{ label: string; count: number; note?: string }>; total: number }) {
  return (
    <table className="w-full max-w-xl text-left text-sm">
      <thead className="border-b border-border text-[13px] text-muted-foreground">
        <tr>
          <th scope="col" className="py-2 pr-4 font-medium">Answer</th>
          <th scope="col" className="py-2 pr-4 text-right font-medium">People</th>
          <th scope="col" className="py-2 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/70">
        {rows.map(r => (
          <tr key={r.label}>
            <td className="py-2 pr-4 text-foreground">
              {r.label}
              {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums text-foreground">{r.count}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground">{total ? Math.round((r.count / total) * 100) : 0}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The small icon switches at a card's top right: how to show its result, and for choices their order. */
function CardControls({ views, view, setView, sortable, sorted, setSorted }: { views: View[]; view: View; setView: (v: View) => void; sortable?: boolean; sorted?: boolean; setSorted?: (v: boolean) => void }) {
  const LOOK: Record<View, { icon: typeof BarChart3; label: string }> = {
    chart: { icon: BarChart3, label: 'Chart' },
    weeks: { icon: TrendingUp, label: 'Week by week' },
    table: { icon: Table2, label: 'Table' },
  }
  const btn = (active: boolean) =>
    `inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
      active ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.08)] dark:bg-white/10' : 'text-muted-foreground hover:text-foreground'
    }`
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {sortable && setSorted && (
        <button type="button" aria-pressed={!!sorted} onClick={() => setSorted(!sorted)} className={`${btn(!!sorted)} border border-border`} title={sorted ? 'In the order asked' : 'Most picked first'} aria-label="Most picked first">
          <ArrowDownWideNarrow className="h-4 w-4" />
        </button>
      )}
      <div role="group" aria-label="Show as" className="flex gap-0.5 rounded-md-s bg-muted p-0.5">
        {views.map(v => {
          const { icon: Icon, label } = LOOK[v]
          return (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={btn(view === v)} title={label} aria-label={label}>
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function QuestionCard({ q, block, n, started }: { q: QuestionSummary; block: SurveyBlock; n: number; started: number }) {
  const [view, setView] = useState<View>('chart')
  const [sorted, setSorted] = useState(false)
  const typeLabel = SURVEY_BLOCK_TYPES.find(t => t.type === block.type)?.label
  const scale = block.question?.scale
  const labels: [string | undefined, string | undefined] = [scale?.minLabel, scale?.maxLabel]

  const rows: Array<{ label: string; count: number; note?: string }> =
    q.kind === 'choice'
      ? [...q.options.map(o => ({ label: o.label, count: o.count })), ...(q.other.length ? [{ label: 'Other', count: q.other.length }] : [])]
      : q.kind === 'yes_no'
        ? [
            { label: 'Yes', count: q.yes },
            { label: 'No', count: q.no },
          ]
        : q.kind === 'nps'
          ? q.distribution.map((c, i) => ({ label: String(i), count: c, note: i <= 6 ? 'detractor' : i <= 8 ? 'passive' : 'promoter' }))
          : q.kind === 'scale'
            ? q.distribution.map((c, i) => ({ label: String(q.min + i), count: c }))
            : []
  const shownRows = sorted ? [...rows].sort((a, b) => b.count - a.count) : rows
  const views: View[] = q.kind === 'nps' && q.trend.length > 1 ? ['chart', 'weeks', 'table'] : rows.length ? ['chart', 'table'] : []

  return (
    <section className="rounded-md-m border border-border bg-card px-5 py-4 sm:px-6 sm:py-5" aria-labelledby={`q-${q.id}`}>
      <header className="mb-4 flex items-start gap-3">
        <BlockChip type={block.type} label={`Q${n}`} />
        <div className="min-w-0 flex-1">
          <h2 id={`q-${q.id}`} className="text-[15px] font-semibold leading-snug text-foreground">
            {q.title}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {typeLabel} · {q.answered} of {started} answered
          </p>
        </div>
        {q.answered > 0 && views.length > 0 && <CardControls views={views} view={view} setView={setView} sortable={q.kind === 'choice' && rows.length > 2 && view !== 'weeks'} sorted={sorted} setSorted={setSorted} />}
      </header>

      {q.answered === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has answered this yet.</p>
      ) : q.kind === 'nps' ? (
        <div className="flex flex-col gap-5">
          <NpsSummary score={q.score} detractors={q.detractors} passives={q.passives} promoters={q.promoters} />
          {view === 'table' ? <ResultTable rows={rows} total={q.answered} /> : view === 'weeks' ? <NpsTrend weeks={q.trend} /> : <Distribution counts={q.distribution} start={0} colorFor={npsBand} labels={labels} />}
        </div>
      ) : q.kind === 'scale' ? (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-3 divide-x divide-border/70 overflow-hidden rounded-md-s border border-border sm:max-w-xl">
            {[
              ['Average', q.average === null ? '—' : q.average.toFixed(1), `out of ${q.min + q.distribution.length - 1}${block.type === 'rating' ? ' stars' : ''}`],
              ['Most given', String(q.min + q.distribution.indexOf(Math.max(...q.distribution))), `by ${Math.max(...q.distribution)} people`],
              ['Answered', String(q.answered), `of ${started}`],
            ].map(([label, value, sub]) => (
              <div key={label} className="min-w-0 px-4 py-3">
                <dt className="text-[13px] text-muted-foreground">{label}</dt>
                <dd className="text-3xl font-semibold leading-tight tabular-nums tracking-tight text-foreground">{value}</dd>
                <dd className="truncate text-[13px] text-muted-foreground">{sub}</dd>
              </div>
            ))}
          </dl>
          {view === 'table' ? <ResultTable rows={rows} total={q.answered} /> : <Distribution counts={q.distribution} start={q.min} labels={labels} average={q.average} leadMost />}
        </div>
      ) : q.kind === 'choice' || q.kind === 'yes_no' ? (
        <div className="flex flex-col gap-4">
          {view === 'table' ? <ResultTable rows={shownRows} total={q.answered} /> : <BarList rows={shownRows} total={q.answered} />}
          {block.type === 'multiple_choice' && <p className="text-[13px] text-muted-foreground">People could pick more than one, so the shares add up to more than 100%.</p>}
          {q.kind === 'choice' && q.other.length > 0 && <OtherAnswers values={q.other} />}
        </div>
      ) : q.kind === 'number' ? (
        <dl className="grid max-w-md grid-cols-3 divide-x divide-border/70 overflow-hidden rounded-md-s border border-border">
          {[
            ['Average', q.average],
            ['Lowest', q.min],
            ['Highest', q.max],
          ].map(([label, value]) => (
            <div key={label as string} className="px-4 py-2.5">
              <dt className="text-[13px] text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <TextAnswers answers={q.latest} total={q.answered} />
      )}
    </section>
  )
}

const SHOWN = 5

/** The latest written answers, five at first, then all of them with a search. */
function TextAnswers({ answers, total }: { answers: Array<{ value: string; at: string; email: string | null }>; total: number }) {
  const [all, setAll] = useState(false)
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const shown = (all ? answers : answers.slice(0, SHOWN)).filter(a => !q || a.value.toLowerCase().includes(q))
  return (
    <div className="flex flex-col gap-3">
      {all && answers.length > SHOWN && (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input className={`${INPUT_CLASS} pl-9`} placeholder="Search answers" aria-label="Search answers" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}
      <ul className="divide-y divide-border/70 overflow-hidden rounded-md-s border border-border">
        {shown.map((a, i) => (
          <li key={i} className="px-3.5 py-2.5">
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{a.value}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {a.email ?? 'Anonymous'} · {whenShort(a.at)}
            </p>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3.5 py-3 text-sm text-muted-foreground">No answers with “{search.trim()}”.</li>}
      </ul>
      {answers.length > SHOWN && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => (setAll(v => !v), setSearch(''))}>
            {all ? 'Show fewer' : answers.length < total ? `Show the latest ${answers.length}` : `Show all ${answers.length}`}
          </Button>
          {total > answers.length && <span className="text-[13px] text-muted-foreground">Of {total}. Every answer is in the Responses tab and its export.</span>}
        </div>
      )}
    </div>
  )
}

function OtherAnswers({ values }: { values: string[] }) {
  // The same write-in from several people shows once, with how many.
  const counts = new Map<string, { label: string; n: number }>()
  for (const v of values) {
    const key = v.trim().toLowerCase()
    if (!key) continue
    const hit = counts.get(key)
    if (hit) hit.n += 1
    else counts.set(key, { label: v.trim(), n: 1 })
  }
  const grouped = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-foreground">Written in under Other</p>
      <ul className="flex flex-wrap gap-1.5">
        {grouped.slice(0, 16).map(g => (
          <li key={g.label} className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[13px] text-foreground/85">
            {g.label}
            {g.n > 1 && <span className="tabular-nums text-muted-foreground">· {g.n}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
