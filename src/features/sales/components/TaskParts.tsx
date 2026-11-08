import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Building2, CalendarClock, CalendarX2, Check, ChevronDown, Handshake, MoreHorizontal, Plus, Trash2, UserRound } from 'lucide-react'
import { addTaskFn, deleteTaskFn, tasksFn, updateTaskFn } from '../../../server/functions'
import { Avatar } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { queryKeys } from '../../../queryKeys'
import { daysFromNow, dueBucket, dueLabel, dueShort, FOLLOW_UPS, fromLocalInput } from '../tasks'
import type { Activity } from '../types'
import { Select } from '../../../components/ui/Select'

/** What a task is about: at most one of each. */
export type TaskOn = { dealId?: string; companyId?: string; contactEmail?: string }

/** A task as the Tasks page has it: with the names of what it's about, and the page to open. */
export type TaskItem = Activity & { link?: string; deal_name?: string | null; company_name?: string | null; contact_name?: string | null }

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

/** The record a task is about, as the Tasks page links it: the deal first, else the company, else the person. */
function aboutOf(task: TaskItem): { name: string; Icon: typeof Handshake; kind: string } | null {
  if (task.deal_name) return { name: task.deal_name, Icon: Handshake, kind: 'Deal' }
  if (task.company_name) return { name: task.company_name, Icon: Building2, kind: 'Company' }
  if (task.contact_name) return { name: task.contact_name, Icon: UserRound, kind: 'Contact' }
  return null
}

/** "alex.morgan@acme.com" → "Alex Morgan", for an avatar's initials. */
const nameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

/** Ticking a task off: a round control (a square would read as "select"), the check showing on hover. */
function TaskCheck({ done, pending, onToggle }: { done: boolean; pending: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      onClick={onToggle}
      disabled={pending}
      className="group/check relative flex shrink-0 cursor-pointer items-center justify-center rounded-full after:absolute after:-inset-3 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          done ? 'border-accent/70 bg-accent/15 text-accent' : 'border-input text-accent group-hover/check:border-accent'
        }`}
      >
        <Check strokeWidth={3} className={`h-3 w-3 transition-opacity ${done ? '' : 'opacity-0 group-hover/check:opacity-100'}`} />
      </span>
    </button>
  )
}

/** A task's other actions behind "…": move it to another day, or delete it. In a portal, so a list's edge doesn't cut it off. */
function TaskMenu({ task, onChanged }: { task: TaskItem; onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const changed = useTasksChanged(onChanged)
  const move = useMutation({ mutationFn: (dueAt: string | null) => updateTaskFn({ data: { id: task.id, dueAt } }), onSuccess: changed })
  const remove = useMutation({ mutationFn: () => deleteTaskFn({ data: { id: task.id } }), onSuccess: changed })
  const done = Boolean(task.done_at)

  useLayoutEffect(() => {
    if (!open) return setPlace(null)
    const r = buttonRef.current!.getBoundingClientRect()
    const h = menuRef.current?.offsetHeight ?? 260
    const top = window.innerHeight - r.bottom < h + 12 && r.top > h + 12 ? r.top - h - 4 : r.bottom + 4
    setPlace({ top, left: Math.max(8, r.right - 208) })
  }, [open])
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') {
          setOpen(false)
          buttonRef.current?.focus()
        }
        return
      }
      if (e.type === 'scroll' || !(menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node))) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const item = 'flex w-full cursor-pointer items-center gap-2.5 rounded-md-xs px-2.5 py-1.5 text-left text-sm text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Task actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={move.isPending || remove.isPending}
        className="relative -my-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md-xs text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Task actions"
            onKeyDown={onMenuKey}
            style={{ position: 'fixed', top: place?.top ?? -9999, left: place?.left ?? -9999 }}
            className="z-[100] w-52 rounded-md-s border border-border bg-popover p-1 shadow-lg"
          >
            {!done && (
              <>
                <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Move to</p>
                {FOLLOW_UPS.map((f) => (
                  <button key={f.days} type="button" role="menuitem" className={item} onClick={pick(() => move.mutate(daysFromNow(f.days)))}>
                    <CalendarClock aria-hidden className="h-4 w-4 text-muted-foreground" /> {f.label}
                  </button>
                ))}
                {task.due_at && (
                  <button type="button" role="menuitem" className={item} onClick={pick(() => move.mutate(null))}>
                    <CalendarX2 aria-hidden className="h-4 w-4 text-muted-foreground" /> No due date
                  </button>
                )}
                <div role="separator" className="-mx-1 my-1 border-t border-border" />
              </>
            )}
            <button type="button" role="menuitem" className={`${item} text-destructive`} onClick={pick(() => remove.mutate())}>
              <Trash2 aria-hidden className="h-4 w-4" /> Delete
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * One task: tick it off, see when it's due (red once overdue), open what it's about, move or delete it.
 * In a wide list (the Tasks page) what it's about and when sit in aligned columns on one line; in a
 * narrow one (a record's page, a phone) they go under the task.
 */
export function TaskRow({
  task,
  showAbout = false,
  grouped = false,
  showOwner = false,
  onChanged,
}: {
  task: TaskItem
  /** Link to the record it's about (the Tasks page; not on the record itself). */
  showAbout?: boolean
  /** Under a heading that already says overdue, today or done, so the time doesn't repeat it. */
  grouped?: boolean
  /** Who added it, when the list holds more than one person's. */
  showOwner?: boolean
  onChanged?: () => void
}) {
  const changed = useTasksChanged(onChanged)
  const toggle = useMutation({ mutationFn: () => updateTaskFn({ data: { id: task.id, done: !task.done_at } }), onSuccess: changed })
  const done = Boolean(task.done_at)
  const bucket = dueBucket(task.due_at)
  const overdue = !done && bucket === 'overdue'
  const about = showAbout && task.link ? aboutOf(task) : null
  const when = done
    ? grouped
      ? dueShort(task.done_at!)
      : `Done ${dueShort(task.done_at!)}`
    : !task.due_at
      ? grouped
        ? ''
        : 'No due date'
      : grouped
        ? bucket === 'today'
          ? dueShort(task.due_at).replace(/^Today /, '')
          : dueShort(task.due_at)
        : dueLabel(task.due_at)

  return (
    <div className="@container flex items-start gap-3">
      <TaskCheck done={done} pending={toggle.isPending} onToggle={() => toggle.mutate()} />
      <div className="min-w-0 flex-1 @2xl:flex @2xl:items-start @2xl:gap-4">
        <p className={`min-w-0 flex-1 text-sm leading-5 break-words ${done ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground'}`}>
          {task.body}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] leading-5 text-muted-foreground @2xl:mt-0 @2xl:flex-nowrap @2xl:shrink-0">
          <span
            className={`tabular-nums @2xl:order-2 @2xl:w-28 @2xl:text-right ${when ? '' : 'hidden @2xl:block'} ${overdue ? 'font-medium text-destructive' : ''}`}
            title={task.due_at && !done ? dueLabel(task.due_at) : undefined}
          >
            {!grouped && !done && <AlarmClock aria-hidden className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />}
            {when}
          </span>
          {showAbout && (
            <span className={`min-w-0 @2xl:order-1 @2xl:w-48 ${about ? '' : 'hidden @2xl:block'}`}>
              {about && (
                <Link
                  to={task.link!}
                  title={`${about.kind}: ${about.name}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md-xs px-1.5 align-top max-@2xl:-ml-1.5 @2xl:-mx-1.5 @2xl:max-w-[calc(100%+0.75rem)] text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <about.Icon aria-label={about.kind} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{about.name}</span>
                </Link>
              )}
            </span>
          )}
        </div>
      </div>
      {showOwner && task.created_by && (
        <span title={`Added by ${task.created_by}`} className="-my-0.5 hidden @md:block">
          <Avatar name={nameFromEmail(task.created_by)} size="sm" />
          <span className="sr-only">Added by {task.created_by}</span>
        </span>
      )}
      <TaskMenu task={task} onChanged={onChanged} />
    </div>
  )
}

/** Writing a task: what needs doing, and when (a quick choice or a date and time), on one line where there's room. */
export function TaskComposer({
  on,
  onDone,
  placeholder = 'What needs doing?',
  inputId,
}: {
  on: TaskOn
  onDone?: () => void
  placeholder?: string
  /** For a "write one" button elsewhere on the page to focus it. */
  inputId?: string
}) {
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
      className="@container"
    >
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-accent @xl:flex-row @xl:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 px-2">
          <Plus aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">New task</span>
          <input
            id={inputId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholder}
            maxLength={2000}
            required
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/90"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 @xl:flex-none">
            <CalendarClock aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Select
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="Due"
              className="h-[38px] w-full rounded-md-s border border-input bg-card pl-8 pr-2.5 text-sm text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 @xl:w-44"
            >
              {FOLLOW_UPS.map((f) => (
                <option key={f.days} value={String(f.days)}>
                  Due {f.label.toLowerCase()}
                </option>
              ))}
              <option value="custom">Due on a date…</option>
              <option value="none">No due date</option>
            </Select>
          </div>
          {when === 'custom' && (
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              required
              aria-label="Due date and time"
              className="h-[38px] rounded-md-s border border-input bg-card px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          )}
          <Button type="submit" isLoading={add.isPending}>
            Add task
          </Button>
        </div>
      </div>
      {add.error && <p className="mt-1.5 px-1 text-xs text-destructive">{(add.error as Error).message}</p>}
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
