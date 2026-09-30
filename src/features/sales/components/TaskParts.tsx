import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Check, ChevronDown, Trash2 } from 'lucide-react'
import { addTaskFn, deleteTaskFn, tasksFn, updateTaskFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { queryKeys } from '../../../queryKeys'
import { daysFromNow, dueBucket, dueLabel, FOLLOW_UPS, fromLocalInput } from '../tasks'
import type { Activity } from '../types'

/** What a task is about: at most one of each. */
export type TaskOn = { dealId?: string; companyId?: string; contactEmail?: string }

/** After any task change: the Tasks page, the sidebar count, and the record pages refetch. */
function useTasksChanged(onChanged?: () => void) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sales.tasks() })
    void queryClient.invalidateQueries({ queryKey: ['sales', 'deal'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sales.companies() })
    onChanged?.()
  }
}

/** One task: tick it off, see when it's due (red once overdue), open what it's about, delete it. */
export function TaskRow({
  task,
  about,
  onChanged,
}: {
  task: Activity & { link?: string }
  /** Shown as a link to the record, e.g. "Acme renewal" (the Tasks page; not on the record itself). */
  about?: string | null
  onChanged?: () => void
}) {
  const changed = useTasksChanged(onChanged)
  const toggle = useMutation({ mutationFn: () => updateTaskFn({ data: { id: task.id, done: !task.done_at } }), onSuccess: changed })
  const remove = useMutation({ mutationFn: () => deleteTaskFn({ data: { id: task.id } }), onSuccess: changed })
  const done = Boolean(task.done_at)
  const overdue = !done && dueBucket(task.due_at) === 'overdue'
  return (
    <div className="group flex items-start gap-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onClick={() => toggle.mutate()}
        disabled={toggle.isPending}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          done ? 'border-accent bg-accent text-accent-foreground' : 'border-input hover:border-accent'
        }`}
      >
        {done && <Check className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-sm break-words ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{task.body}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className={`inline-flex items-center gap-1 tabular-nums ${overdue ? 'font-medium text-destructive' : ''}`}>
            <AlarmClock className="h-3 w-3" /> {done ? `Done ${dueLabel(task.done_at).replace(/^Overdue · /, '').replace(/^Today/, 'today')}` : dueLabel(task.due_at)}
          </span>
          {about && task.link && (
            <Link to={task.link} className="hover:text-foreground hover:underline">
              · {about}
            </Link>
          )}
          <button
            type="button"
            onClick={() => remove.mutate()}
            aria-label="Delete task"
            className="ml-1 opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Writing a task: what needs doing, and when (a quick choice or a date and time). */
export function TaskComposer({ on, onDone, placeholder = 'What needs doing?' }: { on: TaskOn; onDone?: () => void; placeholder?: string }) {
  const [body, setBody] = useState('')
  const [when, setWhen] = useState<string>('3')
  const [custom, setCustom] = useState('')
  const changed = useTasksChanged(onDone)
  const dueAt = when === 'none' ? null : when === 'custom' ? fromLocalInput(custom) : daysFromNow(Number(when))
  const add = useMutation({
    mutationFn: () => addTaskFn({ data: { ...on, body, dueAt } }),
    onSuccess: () => {
      setBody('')
      changed()
    },
  })
  const ready = body.trim() && (when !== 'custom' || dueAt)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) add.mutate()
      }}
      className="space-y-2"
    >
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        maxLength={2000}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="task-when">
          Due
        </label>
        <select
          id="task-when"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
        >
          {FOLLOW_UPS.map((f) => (
            <option key={f.days} value={String(f.days)}>
              {f.label}
            </option>
          ))}
          <option value="custom">Pick a date…</option>
          <option value="none">No due date</option>
        </select>
        {when === 'custom' && (
          <input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="Due date and time"
            className="rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
          />
        )}
        <span className="flex-1 text-xs text-destructive">{(add.error as Error | null)?.message}</span>
        <Button type="submit" size="sm" isLoading={add.isPending} disabled={!ready}>
          Add task
        </Button>
      </div>
    </form>
  )
}

/** "Follow up": a task to follow up with someone, due tomorrow, in 3 days, a week or two. */
export function FollowUpButton({ on, name, onAdded }: { on: TaskOn; name: string; onAdded?: () => void }) {
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const changed = useTasksChanged(onAdded)
  const add = useMutation({
    mutationFn: (f: (typeof FOLLOW_UPS)[number]) =>
      addTaskFn({ data: { ...on, body: `Follow up with ${name}`, dueAt: daysFromNow(f.days) } }).then(() => f.label.toLowerCase()),
    onSuccess: (label) => {
      setOpen(false)
      setAdded(label)
      changed()
    },
  })
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  useEffect(() => {
    if (!added) return
    const t = setTimeout(() => setAdded(null), 3000)
    return () => clearTimeout(t)
  }, [added])
  return (
    <div ref={ref} className="relative inline-flex items-center gap-2">
      {added && (
        <span className="text-xs text-muted-foreground" role="status">
          Task added, due {added}.
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        isLoading={add.isPending}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        leftIcon={<AlarmClock className="h-3.5 w-3.5" />}
        rightIcon={<ChevronDown className="h-3.5 w-3.5" />}
      >
        Follow up
      </Button>
      {open && (
        <ul role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-card py-1 shadow-lg">
          {FOLLOW_UPS.map((f) => (
            <li key={f.days}>
              <button
                type="button"
                role="menuitem"
                onClick={() => add.mutate(f)}
                className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted"
              >
                {f.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One record's tasks (open ones, then recently done), with a box to add another. */
export function RecordTasks({ on }: { on: TaskOn }) {
  const { data = [], isLoading } = useQuery({ queryKey: queryKeys.sales.tasks(on), queryFn: () => tasksFn({ data: on }) })
  return (
    <div className="space-y-4">
      {isLoading ? null : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((t) => (
            <li key={t.id}>
              <TaskRow task={t} />
            </li>
          ))}
        </ul>
      )}
      <TaskComposer on={on} />
    </div>
  )
}
