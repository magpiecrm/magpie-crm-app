import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Calendar1, CalendarCheck, CalendarClock, CalendarDays, CalendarOff, CheckCircle2, ChevronDown, type LucideIcon } from 'lucide-react'
import { queryKeys } from '../../queryKeys'
import { tasksFn } from '../../server/functions'
import { dueBucket, type DueBucket } from '../../features/sales/tasks'
import { TaskComposer, TaskRow } from '../../features/sales/components/TaskParts'
import { useCurrentUserEmail } from '../../features/sales/components/useSalesLookups'

export const Route = createFileRoute('/sales/tasks')({
  component: TasksPage,
})

type SectionId = DueBucket | 'done'

// One family of calendar glyphs; only Overdue is coloured, as it's the one that asks for something.
const SECTIONS: Array<{ id: SectionId; label: string; Icon: LucideIcon }> = [
  { id: 'overdue', label: 'Overdue', Icon: CalendarClock },
  { id: 'today', label: 'Today', Icon: Calendar1 },
  { id: 'upcoming', label: 'Upcoming', Icon: CalendarDays },
  { id: 'none', label: 'No due date', Icon: CalendarOff },
  { id: 'done', label: 'Done in the last 2 weeks', Icon: CalendarCheck },
]

/** Starting points on the empty page: picking one puts it in the box above. */
const EXAMPLES = ['Call Sam about the renewal', 'Send the proposal to Acme', 'Check in after the demo']

const LINK = 'font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent'

/** Everyone's tasks, or only the ones you wrote: shown when more than one person writes them. */
function WhoseToggle({ whose, onChange }: { whose: 'all' | 'mine'; onChange: (w: 'all' | 'mine') => void }) {
  return (
    <div role="radiogroup" aria-label="Whose tasks" className="flex shrink-0 gap-0.5 rounded-md-s bg-muted p-0.5">
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
          className={`cursor-pointer rounded-[7px] px-2.5 py-1 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            whose === id ? 'bg-card font-medium text-foreground shadow-sm dark:bg-muted-hover' : 'text-muted-foreground hover:text-foreground'
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
  const [seed, setSeed] = useState<{ text: string; key: number }>()
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
    <div className="mx-auto w-full max-w-5xl p-4 lg:p-8">
      <div className="mb-5 flex min-h-9 items-center justify-between gap-4">
        <h1 className="text-2xl font-display text-foreground">Tasks</h1>
        {team && <WhoseToggle whose={whose} onChange={setWhose} />}
      </div>

      <TaskComposer on={{}} placeholder="Add a task, e.g. Call Sam back" inputId="new-task" seed={seed} />

      <div className="mt-5">
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : isLoading ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Loading tasks">
            {[70, 55, 62].map((w) => (
              <div key={w} className="flex items-center gap-3">
                <span className="h-5 w-5 rounded-full bg-muted" />
                <span className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-10 text-center shadow-sm">
            <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent">
              <CalendarCheck aria-hidden className="h-5 w-5" />
            </span>
            <h2 className="text-base font-semibold text-foreground">No tasks yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-pretty text-sm text-muted-foreground">
              Write follow-ups and to-dos above, and you'll get a notification when each one is due. From a{' '}
              <Link to="/marketing/contacts" className={LINK}>
                contact
              </Link>{' '}
              or a{' '}
              <Link to="/sales/deals" className={LINK}>
                deal
              </Link>
              , <span className="whitespace-nowrap font-medium text-foreground">Follow up</span> adds one for you.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <span className="text-[13px] text-muted-foreground">Try one:</span>
              {EXAMPLES.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setSeed({ text, key: Date.now() })}
                  className="cursor-pointer rounded-full border border-border bg-card px-3 py-1 text-[13px] text-foreground transition-colors hover:border-input hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // Edge to edge on a phone, so rows get the whole width.
          <div className="overflow-clip rounded-xl border border-border bg-card shadow-sm max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:shadow-none">
            {open === 0 && (
              <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <CheckCircle2 aria-hidden className="h-4 w-4 text-accent" /> Nothing left to do.
              </p>
            )}
            {SECTIONS.map((s) => {
              const rows = inSection(s.id)
              if (!rows.length) return null
              const shut = Boolean(closed[s.id])
              const red = s.id === 'overdue'
              return (
                <section key={s.id} aria-labelledby={`tasks-${s.id}`} className="border-t border-border first:border-t-0">
                  <h2
                    id={`tasks-${s.id}`}
                    className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))] dark:bg-muted"
                  >
                    <button
                      type="button"
                      aria-expanded={!shut}
                      onClick={() => setClosed((c) => ({ ...c, [s.id]: !shut }))}
                      className="flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 dark:hover:bg-muted-hover"
                    >
                      <s.Icon aria-hidden className={`h-4 w-4 ${red ? 'text-destructive' : 'text-muted-foreground'}`} />
                      <span className={red ? 'text-destructive' : ''}>{s.label}</span>
                      <span className="rounded-full bg-card px-1.5 text-xs font-semibold tabular-nums text-foreground/70">{rows.length}</span>
                      <ChevronDown aria-hidden className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${shut ? '-rotate-90' : ''}`} />
                    </button>
                  </h2>
                  {!shut && (
                    <ul>
                      {rows.map((t) => (
                        // Dividers start at the title and stay faint, so the groups' bands carry the structure.
                        <li
                          key={t.id}
                          className="relative px-4 py-2.5 transition-colors hover:bg-muted/40 not-first:before:absolute not-first:before:left-12 not-first:before:right-0 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border/70"
                        >
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
