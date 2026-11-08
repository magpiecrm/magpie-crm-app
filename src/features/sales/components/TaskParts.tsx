import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Building2, Calendar, CalendarClock, CalendarX2, Check, ChevronDown, CirclePoundSterling, MoreHorizontal, Plus, Trash2, UserRound, type LucideIcon } from 'lucide-react'
import { addTaskFn, deleteTaskFn, tasksFn, updateTaskFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { queryKeys } from '../../../queryKeys'
import { daysFromNow, dueBucket, dueLabel, dueParts, FOLLOW_UPS, fromLocalInput, lateBy } from '../tasks'
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
function aboutOf(task: TaskItem): { name: string; Icon: LucideIcon; kind: string } | null {
  if (task.deal_name) return { name: task.deal_name, Icon: CirclePoundSterling, kind: 'Deal' }
  if (task.company_name) return { name: task.company_name, Icon: Building2, kind: 'Company' }
  if (task.contact_name) return { name: task.contact_name, Icon: UserRound, kind: 'Contact' }
  return null
}

/** Each person keeps one of these, so a team's tasks can be told apart at a glance. */
const OWNER_TONES = [
  'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  'bg-violet-500/15 text-violet-800 dark:text-violet-300',
  'bg-amber-500/20 text-amber-900 dark:text-amber-300',
  'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  'bg-rose-500/15 text-rose-800 dark:text-rose-300',
  'bg-teal-500/15 text-teal-800 dark:text-teal-300',
]

/** Who added a task: their initials in their own colour, their address on hover. */
function Owner({ email, small = false }: { email: string; small?: boolean }) {
  const name = nameFromEmail(email)
  const tone = OWNER_TONES[[...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % OWNER_TONES.length]
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
  return (
    <span
      title={`Added by ${email}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tone} ${small ? 'h-[18px] w-[18px] text-[10px]' : 'h-6 w-6 text-[11px]'}`}
    >
      <span aria-hidden>{initials}</span>
      <span className="sr-only">Added by {email}</span>
    </span>
  )
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
          done ? 'border-accent/50 bg-accent/15 text-accent' : 'border-input text-accent group-hover/check:border-accent'
        }`}
      >
        <Check strokeWidth={3} className={`h-3 w-3 transition-opacity ${done ? '' : 'opacity-0 group-hover/check:opacity-100'}`} />
      </span>
    </button>
  )
}

/**
 * A task's actions in a menu: move it to another day, or delete it. Opened from "…", or from the due
 * time itself (`trigger`, moving only). In a portal, so a list's edge doesn't cut it off.
 */
function TaskMenu({
  task,
  onChanged,
  trigger,
  triggerLabel,
}: {
  task: TaskItem
  onChanged?: () => void
  /** What the button shows in place of "…"; the menu then only moves the task. */
  trigger?: React.ReactNode
  triggerLabel?: string
}) {
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
    setPlace({ top, left: Math.max(8, Math.min(r.right - 208, window.innerWidth - 216)) })
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
  const label = trigger ? (triggerLabel ?? 'Move task') : 'Task actions'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={move.isPending || remove.isPending}
        className={
          trigger
            ? 'relative -mx-1.5 inline-flex cursor-pointer items-center rounded-md-xs px-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted'
            : // Shown when the row is pointed at or focused, so eleven of them don't make a stripe; always there on touch.
              "relative -my-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md-xs text-muted-foreground transition-[color,background-color,opacity] after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground aria-expanded:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100"
        }
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
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
              </>
            )}
            {!trigger && (
              <>
                {!done && <div role="separator" className="-mx-1 my-1 border-t border-border" />}
                <button type="button" role="menuitem" className={`${item} text-destructive`} onClick={pick(() => remove.mutate())}>
                  <Trash2 aria-hidden className="h-4 w-4" /> Delete
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

/** The record a task is about, as a link with its kind's icon. */
function AboutLink({ task, about }: { task: TaskItem; about: NonNullable<ReturnType<typeof aboutOf>> }) {
  return (
    <Link
      to={task.link!}
      title={`${about.kind}: ${about.name}`}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md-xs bg-muted px-1.5 align-top text-[13px] leading-5 text-foreground/75 transition-colors hover:bg-muted-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <about.Icon aria-label={about.kind} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{about.name}</span>
    </Link>
  )
}

/**
 * One task: tick it off, see when it's due (red once overdue), open what it's about, move or delete it.
 * In a wide list (the Tasks page) the record follows the title and the due time sits in a column that
 * lines the times up; in a narrow one (a record's page, a phone) they go on one line under the task.
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
  const owner = showOwner && task.created_by ? task.created_by : null

  // When. In a group, two slots that line up down the list: the day, then the time (or how late, or "Done").
  let day = ''
  let second = ''
  if (done) {
    day = dueParts(task.done_at!).day
    second = 'Done'
  } else if (task.due_at) {
    day = dueParts(task.due_at).day
    second = overdue ? lateBy(task.due_at) : dueParts(task.due_at).time
  }
  const whenText = grouped ? [day, second].filter(Boolean).join(' ') : done ? `Done ${day}` : task.due_at ? dueLabel(task.due_at) : 'No due date'
  const movable = grouped && !done && Boolean(task.due_at)
  const title = task.due_at && !done ? `Due ${dueLabel(task.due_at).replace(/^Overdue · /, '')}` : undefined
  const whenNode = grouped ? (
    <span title={title} className="inline-flex shrink-0 items-baseline gap-2 whitespace-nowrap tabular-nums">
      <span className={`@2xl:w-[4.75rem] @2xl:text-left ${day ? 'text-foreground/80' : 'text-muted-foreground'}`}>{day || '—'}</span>
      {second && <span className={`@2xl:w-16 @2xl:text-right ${overdue ? 'font-medium text-destructive' : done ? 'text-muted-foreground' : 'text-foreground/80'}`}>{second}</span>}
    </span>
  ) : (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap tabular-nums ${overdue ? 'text-destructive' : ''}`}>
      {!done && <AlarmClock aria-hidden className="h-3.5 w-3.5" />}
      {whenText}
    </span>
  )

  return (
    <div className="group/row @container flex items-start gap-3">
      <TaskCheck done={done} pending={toggle.isPending} onToggle={() => toggle.mutate()} />
      <div className="min-w-0 flex-1 @2xl:flex @2xl:items-start @2xl:gap-4">
        <div className="min-w-0 flex-1 @2xl:flex @2xl:items-start @2xl:gap-3">
          <p className={`min-w-0 text-sm leading-5 break-words ${done ? 'text-muted-foreground' : 'text-foreground'}`}>{task.body}</p>
          {about && (
            <span className="hidden min-w-0 max-w-56 shrink-0 @2xl:flex">
              <AboutLink task={task} about={about} />
            </span>
          )}
        </div>
        {/* A phone or a record's page: one line under the task, the record shortened to fit. */}
        {((grouped ? day : whenText) || about || owner) && (
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[13px] leading-5 text-muted-foreground @2xl:hidden">
            {(day || !grouped) && (movable ? <TaskMenu task={task} onChanged={onChanged} trigger={whenNode} triggerLabel={`Due ${whenText}. Move it`} /> : whenNode)}
            {about && (
              <span className="flex min-w-0">
                <AboutLink task={task} about={about} />
              </span>
            )}
            {owner && (
              <span className={`ml-auto shrink-0 ${done ? 'opacity-50' : ''}`}>
                <Owner email={owner} small />
              </span>
            )}
          </div>
        )}
        {/* A wide list: the due time in a right-aligned column, the times lined up. */}
        {grouped && (
          <div className="hidden w-40 shrink-0 text-[13px] leading-5 text-muted-foreground @2xl:flex">
            {movable ? <TaskMenu task={task} onChanged={onChanged} trigger={whenNode} triggerLabel={`Due ${whenText}. Move it`} /> : whenNode}
          </div>
        )}
      </div>
      {owner && (
        <span className={`-my-0.5 hidden @2xl:block ${done ? 'opacity-50' : ''}`}>
          <Owner email={owner} />
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
  seed,
}: {
  on: TaskOn
  onDone?: () => void
  placeholder?: string
  /** For a "write one" button elsewhere on the page to focus it. */
  inputId?: string
  /** Text to put in the box (an example picked elsewhere on the page); a new `key` puts it in again. */
  seed?: { text: string; key: number }
}) {
  const [body, setBody] = useState('')
  useEffect(() => {
    if (!seed) return
    setBody(seed.text)
    if (inputId) document.getElementById(inputId)?.focus()
  }, [seed?.key])
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
        <label className="flex min-w-0 flex-1 items-center gap-3 pl-2 pr-2">
          <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
            <Plus className="h-4 w-4" />
          </span>
          <span className="sr-only">New task</span>
          <input
            id={inputId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholder}
            maxLength={2000}
            required
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-0">
            <Calendar aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Select
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="Due"
              className="h-[38px] rounded-md-s bg-transparent pl-8 pr-2.5 text-sm text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
