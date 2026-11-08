import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CalendarClock, CalendarDays, CalendarOff, CheckCircle2, ChevronDown, type LucideIcon } from 'lucide-react'
import { queryKeys } from '../../queryKeys'
import { tasksFn } from '../../server/functions'
import { dueBucket, type DueBucket } from '../../features/sales/tasks'
import { TaskComposer, TaskRow } from '../../features/sales/components/TaskParts'
import { useCurrentUserEmail } from '../../features/sales/components/useSalesLookups'

export const Route = createFileRoute('/sales/tasks')({
  component: TasksPage,
})

type SectionId = DueBucket | 'done'

const SECTIONS: Array<{ id: SectionId; label: string; Icon: LucideIcon; tone: string }> = [
  { id: 'overdue', label: 'Overdue', Icon: AlertCircle, tone: 'text-destructive' },
  { id: 'today', label: 'Today', Icon: CalendarClock, tone: 'text-accent' },
  { id: 'upcoming', label: 'Upcoming', Icon: CalendarDays, tone: 'text-muted-foreground' },
  { id: 'none', label: 'No due date', Icon: CalendarOff, tone: 'text-muted-foreground' },
  { id: 'done', label: 'Done in the last 2 weeks', Icon: CheckCircle2, tone: 'text-muted-foreground' },
]

/** Everyone's tasks, or only the ones you wrote: shown when more than one person writes them. */
function WhoseToggle({ whose, onChange }: { whose: 'all' | 'mine'; onChange: (w: 'all' | 'mine') => void }) {
  return (
    <div role="radiogroup" aria-label="Whose tasks" className="flex shrink-0 gap-1 rounded-md-s bg-muted p-1 max-sm:w-full">
      {(
        [
          ['all', 'Everyone'],
          ['mine', 'Mine'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={whose === id}
          onClick={() => onChange(id)}
          className={`cursor-pointer rounded-[7px] px-3 py-1.5 text-sm transition-colors max-sm:flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            whose === id ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function TasksPage() {
  const me = useCurrentUserEmail()
  const [whose, setWhose] = useState<'mine' | 'all'>('all')
  // Done tasks stay out of the way until asked for.
  const [closed, setClosed] = useState<Partial<Record<SectionId, boolean>>>({ done: true })
  const { data = [], isLoading, error } = useQuery({ queryKey: queryKeys.sales.tasks({}), queryFn: () => tasksFn({ data: {} }) })

  // A team sees everyone's tasks, and can narrow them to the ones they wrote.
  const team = new Set(data.map((t) => t.created_by).filter(Boolean)).size > 1
  const tasks = team && whose === 'mine' ? data.filter((t) => t.created_by === me) : data
  const now = new Date()
  const inSection = (id: SectionId) => tasks.filter((t) => (id === 'done' ? t.done_at : !t.done_at && dueBucket(t.due_at, now) === id))
  const open = tasks.filter((t) => !t.done_at).length
  const empty = !isLoading && !error && data.length === 0

  // With nothing here yet, the box to write one is where to start (not on a phone, where it would open the keyboard).
  useEffect(() => {
    if (empty && window.matchMedia('(hover: hover)').matches) document.getElementById('new-task')?.focus()
  }, [empty])

  return (
    <div className="mx-auto w-full max-w-4xl p-4 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-display text-foreground mb-1">Tasks</h1>
          <p className="text-sm text-muted-foreground">Follow-ups and to-dos. You'll get a notification when each one is due.</p>
        </div>
        {team && <WhoseToggle whose={whose} onChange={setWhose} />}
      </div>

      <TaskComposer on={{}} placeholder="Add a task, e.g. Call Sam back" inputId="new-task" />

      <div className="mt-6">
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : isLoading ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Loading tasks">
            {[70, 55, 62].map((w) => (
              <div key={w} className="flex items-center gap-3">
                <span className="h-[18px] w-[18px] rounded-full bg-muted" />
                <span className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-14 text-center shadow-sm">
            <div aria-hidden className="mx-auto mb-6 w-60 space-y-2 rounded-lg border border-border bg-background p-3 text-left">
              {[78, 58, 68].map((w, i) => (
                <div key={w} className="flex items-center gap-2.5">
                  <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] ${i === 0 ? 'border-accent' : 'border-input'}`} />
                  <span className={`h-2 rounded-full ${i === 0 ? 'bg-foreground/25' : 'bg-foreground/10'}`} style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
            <h2 className="text-base font-semibold text-foreground">No tasks yet</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
              Add one above, or open a{' '}
              <Link to="/marketing/contacts" className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
                contact
              </Link>{' '}
              or{' '}
              <Link to="/sales/deals" className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
                deal
              </Link>{' '}
              and press Follow up. You'll get a notification when each one is due.
            </p>
          </div>
        ) : (
          <div className="overflow-clip rounded-xl border border-border bg-card shadow-sm">
            {open === 0 && (
              <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <CheckCircle2 aria-hidden className="h-4 w-4 text-accent" /> Nothing left to do.
              </p>
            )}
            {SECTIONS.map((s) => {
              const rows = inSection(s.id)
              if (!rows.length) return null
              const shut = Boolean(closed[s.id])
              return (
                <section key={s.id} aria-labelledby={`tasks-${s.id}`} className="border-t border-border first:border-t-0">
                  <h2 id={`tasks-${s.id}`} className={`sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 bg-background dark:bg-muted ${shut ? '' : 'border-b border-border'}`}>
                    <button
                      type="button"
                      aria-expanded={!shut}
                      onClick={() => setClosed((c) => ({ ...c, [s.id]: !shut }))}
                      className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                    >
                      <s.Icon aria-hidden className={`h-4 w-4 ${s.tone}`} />
                      <span className={s.id === 'overdue' ? 'text-destructive' : ''}>{s.label}</span>
                      <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-foreground/70 dark:bg-card">{rows.length}</span>
                      <ChevronDown aria-hidden className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${shut ? '-rotate-90' : ''}`} />
                    </button>
                  </h2>
                  {!shut && (
                    <ul className="divide-y divide-border">
                      {rows.map((t) => (
                        <li key={t.id} className="px-4 py-2.5 transition-colors hover:bg-muted/40">
                          <TaskRow task={t} showAbout grouped showOwner={team && whose === 'all'} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
