import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { tasksFn } from '../../server/functions'
import { FIELD_CLASS } from '../../features/sales/forms'
import { dueBucket, type DueBucket } from '../../features/sales/tasks'
import { TaskComposer, TaskRow } from '../../features/sales/components/TaskParts'
import { useCurrentUserEmail } from '../../features/sales/components/useSalesLookups'

export const Route = createFileRoute('/sales/tasks')({
  component: TasksPage,
})

const SECTIONS: Array<{ id: DueBucket | 'done'; label: string }> = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'none', label: 'No due date' },
  { id: 'done', label: 'Done in the last 2 weeks' },
]

function TasksPage() {
  const me = useCurrentUserEmail()
  const [whose, setWhose] = useState<'mine' | 'all'>('all')
  const { data = [], isLoading, error } = useQuery({ queryKey: queryKeys.sales.tasks({}), queryFn: () => tasksFn({ data: {} }) })

  // A team sees everyone's tasks, and can narrow them to the ones they wrote.
  const team = new Set(data.map((t) => t.created_by).filter(Boolean)).size > 1
  const tasks = team && whose === 'mine' ? data.filter((t) => t.created_by === me) : data
  const now = new Date()
  const inSection = (id: DueBucket | 'done') => tasks.filter((t) => (id === 'done' ? t.done_at : !t.done_at && dueBucket(t.due_at, now) === id))
  const open = tasks.filter((t) => !t.done_at).length

  return (
    <div className="p-4 lg:p-8 max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-1">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Follow-ups and to-dos. You'll get a notification when each one is due.
          </p>
        </div>
        {team && (
          <select value={whose} onChange={(e) => setWhose(e.target.value as 'mine' | 'all')} aria-label="Whose tasks" className={`${FIELD_CLASS} sm:w-44`}>
            <option value="all">Everyone's tasks</option>
            <option value="mine">My tasks</option>
          </select>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 mb-8">
        <TaskComposer on={{}} placeholder="New task, e.g. Call Sam about the renewal" />
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No tasks yet. Add one above, or use Follow up on a contact or deal.
        </p>
      ) : (
        <div className="space-y-8">
          {open === 0 && <p className="text-sm text-muted-foreground">Nothing left to do.</p>}
          {SECTIONS.map((s) => {
            const rows = inSection(s.id)
            if (!rows.length) return null
            return (
              <section key={s.id} aria-labelledby={`tasks-${s.id}`}>
                <h2
                  id={`tasks-${s.id}`}
                  className={`font-mono text-[11px] font-medium uppercase tracking-[0.08em] mb-3 ${s.id === 'overdue' ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {s.label} <span className="tabular-nums">· {rows.length}</span>
                </h2>
                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                  {rows.map((t) => (
                    <li key={t.id} className="px-4 py-3">
                      <TaskRow task={t} about={t.deal_name ?? t.company_name ?? t.contact_name} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
