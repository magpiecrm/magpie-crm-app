import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Clock, Mail, Search, Trash2, UserRound } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { deleteSurveyResponseFn, deleteSurveyResponsesFn, getSurveyResponsesFn } from '../../../server/functions'
import { Select } from '../../../components/ui/Select'
import { Button } from '../../../components/ui/Button'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { Pagination } from '../../../components/ui/Pagination'
import { ActionMenu } from '../../../components/ui/ActionMenu'
import { ColumnsMenu, useStoredColumns } from '../../../components/ui/ColumnsMenu'
import { confirmDialog } from '../../../components/ui/confirm'
import { toast } from '../../../components/ui/toast'
import type { ExportColumn } from '../../../utils/export'
import type { AnswerValue, Survey, SurveyBlock } from '../../survey-builder/types'
import { isQuestionType } from '../../survey-builder/types'
import { answerToDisplay } from '../../survey-builder/logic/answers'
import { BlockChip } from '../../survey-builder/blockIcons'
import { exactTime, whenShort } from '../../forms/format'
import { SOURCE_LABELS, SOURCE_PHRASES } from '../sources'

type ResponseRow = Awaited<ReturnType<typeof getSurveyResponsesFn>>[number]
type Question = { block: SurveyBlock; n: number; pageId: string }

const SOURCE_COLUMN = '__source'
const personOf = (r: ResponseRow) => r.contactName || r.contact_email || ''
const sourceText = (r: ResponseRow) => [SOURCE_LABELS[r.source] ?? r.source, r.campaignName].filter(Boolean).join(' · ')

/** What a question's cell says when it has no answer: why not. */
function missing(r: ResponseRow, q: Question): string {
  if (r.path.includes(q.pageId) || r.current_page_id === q.pageId) return 'Not answered'
  return r.status === 'completed' ? 'Skipped by logic' : 'Not reached'
}

/** An answer drawn for a table cell or the response pop-up: an NPS score in its group's colour, stars for a rating, choices as pills. */
function Answer({ block, value, full }: { block: SurveyBlock; value: AnswerValue; full?: boolean }) {
  if (block.type === 'nps' && typeof value === 'number') {
    const band = value <= 6 ? ['Detractor', 'bg-[#d6453d]/12 text-[#a3302a] dark:bg-[#e8615a]/20 dark:text-[#f19590]'] : value <= 8 ? ['Passive', 'bg-foreground/[0.07] text-foreground/80'] : ['Promoter', 'bg-[#0a87a0]/12 text-[#066577] dark:bg-[#26a6b8]/20 dark:text-[#7fd3df]']
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums ${band[1]}`}>
        {value}
        {full && <span className="font-medium">· {band[0]}</span>}
      </span>
    )
  }
  if (block.type === 'rating' && typeof value === 'number') {
    const max = block.question?.scale?.max ?? 5
    return (
      <span className="tabular-nums text-foreground" aria-label={`${value} of ${max}`}>
        <span className="text-amber-500" aria-hidden>{'★'.repeat(value)}</span>
        <span className="text-foreground/20" aria-hidden>{'★'.repeat(Math.max(0, max - value))}</span>
        {full && <span className="ml-1.5 text-muted-foreground">{value} of {max}</span>}
      </span>
    )
  }
  if (value && typeof value === 'object' && full) {
    const labels = value.optionIds.map(id => block.question?.options?.find(o => o.id === id)?.label ?? id)
    return (
      <span className="flex flex-wrap gap-1.5">
        {labels.map(l => (
          <span key={l} className="rounded-full border border-border px-2.5 py-0.5 text-[13px] text-foreground">
            {l}
          </span>
        ))}
        {value.other && <span className="rounded-full border border-border px-2.5 py-0.5 text-[13px] text-foreground">Other: {value.other}</span>}
      </span>
    )
  }
  const text = answerToDisplay(block, value)
  return full ? <span className="whitespace-pre-wrap break-words text-sm text-foreground">{text}</span> : <span className="line-clamp-2 break-words" title={text}>{text}</span>
}

function StatusPill({ status }: { status: ResponseRow['status'] }) {
  return status === 'completed' ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-foreground/85">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden />
      Finished
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full border-[1.5px] border-foreground/50" aria-hidden />
      Not finished
    </span>
  )
}

/** Every response to a survey: a table with a column per chosen question, filters, bulk actions, and one response at a time in a pop-up. */
export function SurveyResponses({ survey, empty }: { survey: Survey; empty: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<'all' | '7' | '30' | '90'>('all')
  const [status, setStatus] = useState<'' | 'completed' | 'partial'>('')
  const [source, setSource] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [openId, setOpenId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const { data: responses = [], isLoading } = useQuery({
    queryKey: queryKeys.surveys.responses(survey.id),
    queryFn: () => getSurveyResponsesFn({ data: { id: survey.id } }),
  })

  const questions = useMemo<Question[]>(() => {
    let n = 0
    return survey.design.pages.flatMap(p => p.blocks.filter(b => isQuestionType(b.type)).map(b => ({ block: b, n: ++n, pageId: p.id })))
  }, [survey.design])
  const choosable = [...questions.map(q => ({ key: q.block.id, label: `Q${q.n}. ${q.block.question?.title || 'Untitled question'}` })), { key: SOURCE_COLUMN, label: 'Came from' }]
  // By default, the three questions most people answered, in the survey's order: on a survey with logic, the first three are often skipped.
  const defaults = useMemo(() => {
    const answered = (id: string) => responses.filter(r => r.answers[id] !== undefined && r.answers[id] !== null).length
    const top = new Set([...questions].sort((a, b) => answered(b.block.id) - answered(a.block.id) || a.n - b.n).slice(0, 3).map(q => q.block.id))
    return questions.filter(q => top.has(q.block.id)).map(q => q.block.id)
  }, [questions, responses])
  const [chosen, setChosen] = useStoredColumns(`magpie-survey-columns:${survey.id}`, defaults)
  const columns = choosable.filter(c => chosen.includes(c.key))

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.surveys.survey(survey.id) })
    queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list(), exact: true })
  }
  const removeMany = useMutation({
    mutationFn: (ids: string[]) => deleteSurveyResponsesFn({ data: { surveyId: survey.id, ids } }),
    onSuccess: ({ deleted }) => {
      invalidate()
      setPicked(new Set())
      toast.success(`Deleted ${deleted} response${deleted === 1 ? '' : 's'}`)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteSurveyResponseFn({ data: { id } }),
    onSuccess: () => {
      invalidate()
      setOpenId(null)
      toast.success('Response deleted')
    },
  })

  const q = query.trim().toLowerCase()
  const since = range === 'all' ? '' : new Date(Date.now() - Number(range) * 86400e3).toISOString()
  const shown = useMemo(() => {
    const rows = responses.filter(
      r =>
        (!since || r.started_at >= since) &&
        (!status || r.status === status) &&
        (!source || r.source === source) &&
        (!q || [personOf(r), r.contact_email ?? '', ...questions.map(x => answerToDisplay(x.block, r.answers[x.block.id]))].some(v => v.toLowerCase().includes(q))),
    )
    return rows.sort((a, b) => (sortDir === 'asc' ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)))
  }, [responses, since, status, source, q, sortDir, questions])
  const sources = [...new Set(responses.map(r => r.source))]
  const pageRows = shown.slice((page - 1) * perPage, page * perPage)
  const openIndex = openId ? shown.findIndex(r => r.id === openId) : -1
  const open = openIndex >= 0 ? shown[openIndex] : null
  const filtered = !!q || range !== 'all' || !!status || !!source

  const exportColumns = useMemo<ExportColumn<ResponseRow>[]>(
    () => [
      { header: 'Name', value: r => r.contactName ?? '' },
      { header: 'Email', value: r => r.contact_email ?? '' },
      { header: 'Status', value: r => (r.status === 'completed' ? 'Finished' : 'Not finished') },
      { header: 'Came from', value: r => sourceText(r) },
      { header: 'Started', value: r => exactTime(r.started_at) },
      { header: 'Finished', value: r => (r.completed_at ? exactTime(r.completed_at) : '') },
      ...questions.map(x => ({ header: `Q${x.n}. ${x.block.question?.title || x.block.id}`, value: (r: ResponseRow) => answerToDisplay(x.block, r.answers[x.block.id]) })),
    ],
    [questions],
  )

  if (!isLoading && responses.length === 0) return <>{empty}</>
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1))

  return (
    <div className="flex flex-col gap-3">
      {picked.size > 0 ? (
        <div className="flex min-h-[38px] flex-wrap items-center gap-2 rounded-md-s border border-accent/40 bg-accent/[0.06] px-3 py-1.5" role="region" aria-label="Selected responses">
          <span className="text-sm font-medium text-foreground">{picked.size} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <ExportMenu filename={`${survey.name} (selected)`} rows={shown.filter(r => picked.has(r.id))} columns={exportColumns} sheetName="Responses" label="Export selected" />
            <Button
              variant="secondary"
              leftIcon={<Trash2 className="h-4 w-4" />}
              className="!text-destructive"
              isLoading={removeMany.isPending}
              onClick={async () => {
                const n = picked.size
                const ok = await confirmDialog({
                  title: `Delete ${n} response${n === 1 ? '' : 's'}?`,
                  message: "They're removed from the results. Answers already saved to contacts stay. This can't be undone.",
                  confirmLabel: `Delete ${n}`,
                  tone: 'danger',
                })
                if (ok) removeMany.mutate([...picked])
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-64 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input className={`${INPUT_CLASS} pl-9`} placeholder="Search people and answers" aria-label="Search responses" value={query} onChange={e => resetPage(setQuery)(e.target.value)} />
          </div>
          <Select className={`${INPUT_CLASS} !w-auto`} value={range} onChange={e => resetPage(setRange)(e.target.value as typeof range)} aria-label="When">
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
          {sources.length > 1 && (
            <Select className={`${INPUT_CLASS} !w-auto max-sm:hidden`} value={source} onChange={e => resetPage(setSource)(e.target.value)} aria-label="Where from">
              <option value="">From anywhere</option>
              {sources.map(s => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s] ?? s}
                </option>
              ))}
            </Select>
          )}
          <div className="ml-auto flex items-center gap-2">
            <ColumnsMenu options={choosable} chosen={chosen} onChange={setChosen} />
            <ExportMenu filename={survey.name} rows={shown} columns={exportColumns} sheetName="Responses" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="tablist" aria-label="Finished or not" className="inline-flex gap-1 rounded-md-s bg-muted p-1">
          {(
            [
              ['', 'All', responses.length],
              ['completed', 'Finished', responses.filter(r => r.status === 'completed').length],
              ['partial', 'Not finished', responses.filter(r => r.status === 'partial').length],
            ] as const
          ).map(([value, label, n]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={status === value}
              onClick={() => resetPage(setStatus)(value)}
              className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md-xs px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                status === value ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.08)] dark:bg-white/10' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              <span className="tabular-nums text-muted-foreground">{n}</span>
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {filtered ? `${shown.length} match` : `${responses.length} response${responses.length === 1 ? '' : 's'}`}
          {' · '}
          {columns.filter(c => c.key !== SOURCE_COLUMN).length} of {questions.length} questions shown
        </p>
      </div>

      <div className="overflow-hidden rounded-md-m border border-border bg-card">
        {/* A phone gets one card per response. */}
        <ul className="divide-y divide-border/70 md:hidden">
          {pageRows.map(r => {
            const first = questions.find(x => r.answers[x.block.id] !== undefined && r.answers[x.block.id] !== null)
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left active:bg-muted/50">
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className={`min-w-0 truncate font-semibold ${personOf(r) ? 'text-foreground' : 'text-muted-foreground'}`}>{personOf(r) || 'Anonymous'}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[13px] tabular-nums text-muted-foreground">
                      {whenShort(r.updated_at)}
                      <ChevronRight className="h-4 w-4 self-center" aria-hidden />
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-[13px] text-muted-foreground">
                    <StatusPill status={r.status} />
                    <span className="truncate">{SOURCE_LABELS[r.source] ?? r.source}</span>
                  </span>
                  {first && (
                    <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] text-foreground/85">
                      <span className="shrink-0 text-muted-foreground">Q{first.n}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <Answer block={first.block} value={r.answers[first.block.id]} />
                      </span>
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full table-fixed text-left text-sm" style={{ minWidth: `${44 + columns.length * 15}rem` }}>
            <thead className="border-b border-border bg-muted/40 text-[13px] text-muted-foreground">
              <tr>
                <th scope="col" className="sticky left-0 z-10 w-11 bg-[color-mix(in_srgb,var(--color-card),var(--color-muted)_40%)] py-2.5 pl-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label="Select all on this page"
                    checked={pageRows.length > 0 && pageRows.every(r => picked.has(r.id))}
                    ref={el => {
                      if (el) el.indeterminate = pageRows.some(r => picked.has(r.id)) && !pageRows.every(r => picked.has(r.id))
                    }}
                    onChange={e =>
                      setPicked(p => {
                        const n = new Set(p)
                        for (const r of pageRows) e.target.checked ? n.add(r.id) : n.delete(r.id)
                        return n
                      })
                    }
                  />
                </th>
                <th scope="col" className="sticky left-11 z-10 w-[14rem] bg-[color-mix(in_srgb,var(--color-card),var(--color-muted)_40%)] py-2.5 pl-2 pr-4 font-medium shadow-[1px_0_0_var(--color-border)]">
                  Person
                </th>
                {columns.map(c => (
                  <th key={c.key} scope="col" className="px-4 py-2.5 align-bottom font-medium">
                    <span className="line-clamp-2" title={c.label}>
                      {c.label}
                    </span>
                  </th>
                ))}
                {columns.length === 0 && <th scope="col" />}
                <th scope="col" className="w-[8.5rem] px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'} className="w-[9.5rem] px-4 py-2.5 font-medium">
                  <button type="button" onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))} className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-md-xs px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    Updated
                    {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-foreground" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5 text-foreground" aria-hidden />}
                  </button>
                </th>
                <th scope="col" className="w-10">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {pageRows.map(r => {
                const person = personOf(r)
                return (
                  <tr key={r.id} onClick={() => setOpenId(r.id)} className={`group cursor-pointer transition-colors hover:bg-muted/40 ${picked.has(r.id) ? 'bg-accent/[0.05]' : ''}`}>
                    <td className="sticky left-0 z-[1] bg-card py-3 pl-4 align-top group-hover:bg-[color-mix(in_srgb,var(--color-card),var(--color-muted)_40%)]" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-[18px] w-[18px]"
                        aria-label={`Select ${person || 'this anonymous response'}`}
                        checked={picked.has(r.id)}
                        onChange={e =>
                          setPicked(p => {
                            const n = new Set(p)
                            e.target.checked ? n.add(r.id) : n.delete(r.id)
                            return n
                          })
                        }
                      />
                    </td>
                    <td className="sticky left-11 z-[1] bg-card py-3 pl-2 pr-4 align-top shadow-[1px_0_0_var(--color-border)] group-hover:bg-[color-mix(in_srgb,var(--color-card),var(--color-muted)_40%)]">
                      <button
                        type="button"
                        onClick={e => (e.stopPropagation(), setOpenId(r.id))}
                        className={`block max-w-full cursor-pointer truncate rounded-sm text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${person ? 'text-foreground' : 'text-muted-foreground'}`}
                      >
                        {person || 'Anonymous'}
                      </button>
                      <span className="block truncate text-[13px] text-muted-foreground">{r.contactName ? r.contact_email : SOURCE_LABELS[r.source] ?? r.source}</span>
                    </td>
                    {columns.map(c => {
                      if (c.key === SOURCE_COLUMN) {
                        return (
                          <td key={c.key} className="px-4 py-3 align-top text-foreground/85">
                            <span className="block truncate" title={sourceText(r)}>
                              {sourceText(r)}
                            </span>
                          </td>
                        )
                      }
                      const x = questions.find(y => y.block.id === c.key)!
                      const value = r.answers[c.key]
                      return (
                        <td key={c.key} className="px-4 py-3 align-top text-foreground/85">
                          {value === undefined || value === null ? <span className="text-[13px] text-muted-foreground">{missing(r, x)}</span> : <Answer block={x.block} value={value} />}
                        </td>
                      )
                    })}
                    {columns.length === 0 && <td />}
                    <td className="px-4 py-3 align-top">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-top tabular-nums text-muted-foreground" title={exactTime(r.updated_at)}>
                      {whenShort(r.updated_at)}
                    </td>
                    <td className="py-3 pr-4 align-top text-muted-foreground">
                      <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted-foreground">{q ? <>Nothing matches “{query.trim()}”.</> : 'No responses match these filters.'}</p>}
        {shown.length > 25 && (
          <div className="border-t border-border/70 px-4 py-2">
            <Pagination
              totalItems={shown.length}
              itemsPerPage={perPage}
              onItemsPerPageChange={n => (setPerPage(n), setPage(1))}
              currentPage={page}
              onPageChange={setPage}
              itemsPerPageOptions={[25, 50, 100]}
            />
          </div>
        )}
      </div>

      {open && (
        <ResponseDialog
          response={open}
          questions={questions}
          position={`${openIndex + 1} of ${shown.length}`}
          onPrev={openIndex > 0 ? () => setOpenId(shown[openIndex - 1].id) : undefined}
          onNext={openIndex < shown.length - 1 ? () => setOpenId(shown[openIndex + 1].id) : undefined}
          onClose={() => setOpenId(null)}
          deleting={remove.isPending}
          onDelete={async () => {
            const ok = await confirmDialog({
              title: 'Delete this response?',
              message: "It's removed from the results. Answers already saved to the contact stay. This can't be undone.",
              confirmLabel: 'Delete response',
              tone: 'danger',
            })
            if (ok) remove.mutate(open.id)
          }}
        />
      )}
    </div>
  )
}

function ResponseDialog({
  response: r,
  questions,
  position,
  onPrev,
  onNext,
  onClose,
  onDelete,
  deleting,
}: {
  response: ResponseRow
  questions: Question[]
  position: string
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const navigate = useNavigate()
  const person = personOf(r)
  const took = r.completed_at ? Math.max(0, (Date.parse(r.completed_at) - Date.parse(r.started_at)) / 1000) : null
  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={person || 'Anonymous response'}
      description={r.contactName && r.contact_email ? r.contact_email : r.status === 'completed' ? `Finished ${exactTime(r.completed_at!)}` : `Started ${exactTime(r.started_at)}, not finished`}
      className="sm:max-w-xl"
      headerActions={
        <div className="mr-8 flex items-center gap-0.5" role="group" aria-label={`Response ${position}`}>
          <Button variant="ghost" size="icon" onClick={onPrev} disabled={!onPrev} aria-label="Previous response" className="disabled:!opacity-35">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[3.75rem] text-center text-[13px] tabular-nums text-muted-foreground">{position}</span>
          <Button variant="ghost" size="icon" onClick={onNext} disabled={!onNext} aria-label="Next response" className="disabled:!opacity-35">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <DialogBody className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2 rounded-md-s bg-muted/50 px-3.5 py-3 text-sm text-foreground">
          <li className="flex items-start gap-2.5">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              {SOURCE_PHRASES[r.source] ?? SOURCE_LABELS[r.source] ?? r.source}
              {r.campaignName && <span className="text-muted-foreground"> · {r.campaignName}</span>}
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              {r.status === 'completed' ? (
                <>
                  Finished {exactTime(r.completed_at!)}
                  {took !== null && <span className="text-muted-foreground">, in {took < 60 ? `${Math.round(took)} seconds` : `${Math.round(took / 60)} minute${Math.round(took / 60) === 1 ? '' : 's'}`}</span>}
                </>
              ) : (
                <>Started {exactTime(r.started_at)}, stopped before the end</>
              )}
            </span>
          </li>
        </ul>
        <ol className="divide-y divide-border/70 overflow-hidden rounded-md-s border border-border">
          {questions.map(x => {
            const value = r.answers[x.block.id]
            const has = value !== undefined && value !== null
            return (
              <li key={x.block.id} className="flex gap-3 px-3.5 py-3">
                <BlockChip type={x.block.type} label={`Q${x.n}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-muted-foreground">{x.block.question?.title || 'Untitled question'}</p>
                  <div className="mt-1">{has ? <Answer block={x.block} value={value} full /> : <span className="text-sm italic text-muted-foreground">{missing(r, x)}</span>}</div>
                </div>
              </li>
            )
          })}
        </ol>
      </DialogBody>
      <DialogFooter>
        <div className="mr-auto">
          <ActionMenu
            label="More for this response"
            items={[{ label: deleting ? 'Deleting…' : 'Delete response', icon: Trash2, tone: 'danger', onSelect: onDelete, disabled: deleting }]}
            triggerClassName="inline-flex h-[38px] w-[38px] cursor-pointer items-center justify-center rounded-md-s border border-control bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted dark:bg-white/[0.04]"
          />
        </div>
        {r.isContact && r.contact_email && (
          <Button variant="secondary" leftIcon={<UserRound className="h-4 w-4" />} onClick={() => navigate({ to: '/marketing/contacts', search: { contact: r.contact_email! } })}>
            Open contact
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
