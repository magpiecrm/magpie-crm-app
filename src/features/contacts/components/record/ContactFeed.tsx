import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  ClipboardList,
  FileInput,
  MailOpen,
  Megaphone,
  MessageSquareReply,
  MousePointerClick,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { addNoteFn, deleteNoteFn } from '../../../../server/functions'
import { ActionMenu } from '../../../../components/ui/ActionMenu'
import { Avatar } from '../../../../components/ui/Avatar'
import { Button } from '../../../../components/ui/Button'
import { confirmDialog } from '../../../../components/ui/confirm'
import { toast } from '../../../../components/ui/toast'
import { nameFromEmail } from '../../../sales/utils'
import { formatAgo, formatWhen, monthOf, type FeedItem } from '../../record'

// Each channel its own quiet tint, so a campaign, a sequence email and a form tell apart at a glance.
const KIND: Record<Exclude<FeedItem['kind'], 'note' | 'reply'>, { label: string; Icon: LucideIcon; tint: string }> = {
  campaign: { label: 'Campaign', Icon: Megaphone, tint: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  sequence: { label: 'Sequence email', Icon: Send, tint: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  form: { label: 'Form', Icon: FileInput, tint: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  survey: { label: 'Survey', Icon: ClipboardList, tint: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
}

/** Opened, clicked and replied grow stronger in that order; not opened is only an outline. */
type Tone = 'opened' | 'clicked' | 'replied' | 'done' | 'neutral' | 'none'

/** What came of an email, form or survey: the strongest thing they did. */
function outcome(item: FeedItem): { text: string; Icon: LucideIcon; tone: Tone } | null {
  if (item.kind === 'campaign' || item.kind === 'sequence') {
    if (item.replied) return { text: 'Replied', Icon: MessageSquareReply, tone: 'replied' }
    if (item.clicked) return { text: 'Clicked', Icon: MousePointerClick, tone: 'clicked' }
    if (item.opened) return { text: 'Opened', Icon: MailOpen, tone: 'opened' }
    return { text: 'Not opened', Icon: CircleDashed, tone: 'none' }
  }
  if (item.kind === 'survey')
    return item.completed ? { text: 'Completed', Icon: CheckCircle2, tone: 'done' } : { text: 'Not finished', Icon: CircleDashed, tone: 'none' }
  if (item.kind === 'form') return { text: 'Submitted', Icon: CheckCircle2, tone: 'done' }
  return null
}

/** One look for a state wherever the page shows it: a soft pill with an icon and a word. */
const CHIP_TONE: Record<Tone, string> = {
  opened: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  clicked: 'bg-emerald-500/25 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100',
  replied: 'bg-emerald-700 text-white dark:bg-emerald-600',
  done: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  neutral: 'bg-foreground/[0.07] text-foreground/80',
  none: 'border border-foreground/25 text-muted-foreground',
}

function Chip({ tone, Icon, children }: { tone: Tone; Icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${CHIP_TONE[tone]}`}>
      {Icon && <Icon aria-hidden className="h-3 w-3" />}
      {children}
    </span>
  )
}

function When({ at }: { at: string }) {
  return (
    <time dateTime={at} title={formatWhen(at)} className="shrink-0 whitespace-nowrap text-[13px] text-muted-foreground tabular-nums">
      {formatAgo(at)}
    </time>
  )
}

/** A note's words: a pale yellow slip, so a team's note never reads as something they sent. */
function NoteSlip({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 whitespace-pre-wrap break-words rounded-lg border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-sm leading-6 text-foreground">
      {children}
    </p>
  )
}

function IconDot({ Icon, tint = 'bg-muted text-muted-foreground' }: { Icon: LucideIcon; tint?: string }) {
  return (
    <span aria-hidden className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tint}`}>
      <Icon className="h-4 w-4" />
    </span>
  )
}

function NoteRow({ item, onChanged }: { item: FeedItem; onChanged: () => void }) {
  const note = item.note!
  const author = note.created_by ? nameFromEmail(note.created_by) : null
  const remove = useMutation({
    mutationFn: () => deleteNoteFn({ data: { id: note.id } }),
    onSuccess: onChanged,
    onError: (err) => toast.error("Couldn't delete the note", { description: err instanceof Error ? err.message : undefined }),
  })
  return (
    <>
      <span className="mt-0.5">
        <Avatar name={author ?? 'Note'} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-foreground">
            <span className="font-medium">{author ?? 'Someone'}</span>
            <span className="text-muted-foreground"> wrote a note</span>
          </p>
          <span className="flex shrink-0 items-center gap-1">
            <When at={item.at} />
            <ActionMenu
              label="Note actions"
              width={180}
              triggerClassName="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md-xs text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              items={[
                {
                  label: 'Delete note',
                  icon: Trash2,
                  tone: 'danger',
                  disabled: remove.isPending,
                  onSelect: async () => {
                    const ok = await confirmDialog({
                      title: 'Delete this note?',
                      message: 'It can’t be brought back.',
                      confirmLabel: 'Delete note',
                      tone: 'danger',
                    })
                    if (ok) remove.mutate()
                  },
                },
              ]}
            />
          </span>
        </div>
        <NoteSlip>{note.body}</NoteSlip>
      </div>
    </>
  )
}

function ReplyRow({ item, name }: { item: FeedItem; name: string }) {
  const r = item.reply!
  return (
    <>
      <IconDot Icon={MessageSquareReply} tint="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-sm text-foreground">
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground"> replied to </span>
            {r.sequence_name}
          </p>
          <When at={item.at} />
        </div>
        {/* What came in, drawn like an email: its subject, then its first lines. */}
        <div className="mt-1.5 rounded-lg border border-border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgb(17_19_22/0.05)] dark:bg-white/[0.03]">
          <p className="truncate text-[13px] font-medium text-foreground">{r.subject || 'No subject'}</p>
          <p className="mt-1 line-clamp-3 text-sm leading-6 text-foreground/85">
            {r.excerpt}
            {r.excerpt.length >= 280 ? '…' : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3">
            <Link
              to="/sales/sequences/$id"
              params={{ id: r.sequence_id }}
              search={{ tab: 'replies', person: r.enrollment_id }}
              className="-ml-1.5 inline-flex items-center gap-1 rounded-md-xs px-1.5 py-1 text-[13px] font-medium text-accent hover:bg-accent/10"
            >
              {r.answered ? 'Open the conversation' : 'Reply'}
            </Link>
            {!r.answered && <span className="text-[13px] text-muted-foreground">Not answered yet</span>}
          </div>
        </div>
      </div>
    </>
  )
}

function EventRow({ item }: { item: FeedItem }) {
  const { label, Icon, tint } = KIND[item.kind as keyof typeof KIND]
  const result = outcome(item)
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconDot Icon={Icon} tint={tint} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          {item.url ? (
            <Link to={item.url} className="min-w-0 truncate text-sm font-medium text-foreground hover:text-accent hover:underline">
              {item.title}
            </Link>
          ) : (
            <p className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</p>
          )}
          <When at={item.at} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <span>{label}</span>
          {result && (
            <Chip tone={result.tone} Icon={result.Icon}>
              {result.text}
            </Chip>
          )}
          {item.answers && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="-my-1 inline-flex items-center gap-1 rounded-md-xs px-1.5 py-1 text-[13px] font-medium text-accent hover:bg-accent/10 cursor-pointer"
            >
              <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
              {open ? 'Hide answers' : `${item.answers.length} answer${item.answers.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
        {open && item.answers && (
          <dl className="mt-2 space-y-2.5 border-l-2 border-border pl-3">
            {item.answers.map((a, i) => (
              <div key={i}>
                <dt className="text-[13px] text-muted-foreground">{a.question}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{a.answer || <span className="text-muted-foreground">No answer</span>}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </>
  )
}

function FeedRow({ item, name, onChanged }: { item: FeedItem; name: string; onChanged: () => void }) {
  return (
    <li className="flex gap-3 py-3">
      {item.kind === 'note' ? (
        <NoteRow item={item} onChanged={onChanged} />
      ) : item.kind === 'reply' ? (
        <ReplyRow item={item} name={name} />
      ) : (
        <EventRow item={item} />
      )}
    </li>
  )
}

/** The next email a sequence will send them, above what has happened. */
export function UpcomingRow({ title, at }: { title: string; at: string }) {
  return (
    <li className="flex gap-3 py-3">
      <IconDot Icon={Clock} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">{title}</p>
          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums" title={formatWhen(at)}>
            {formatWhen(at)}
          </span>
        </div>
        <p className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
          Sequence email
          <Chip tone="neutral" Icon={Clock}>
            Scheduled
          </Chip>
        </p>
      </div>
    </li>
  )
}

/** A heading over part of the feed: a month, "Up next", "Latest". */
export function FeedLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="border-b border-border pb-2 text-[13px] font-semibold text-muted-foreground">{children}</h3>
}

/** A contact's history as one list; `months` puts a heading over each month. `name` is who replies are from. */
export function FeedList({
  items,
  name,
  months = false,
  before,
  onChanged,
}: {
  items: FeedItem[]
  name: string
  months?: boolean
  /** Rows to put first (what's coming up). */
  before?: React.ReactNode
  onChanged: () => void
}) {
  if (!months) {
    return (
      <ul className="divide-y divide-border">
        {before}
        {items.map((item) => (
          <FeedRow key={item.key} item={item} name={name} onChanged={onChanged} />
        ))}
      </ul>
    )
  }
  const groups: Array<{ month: string; items: FeedItem[] }> = []
  for (const item of items) {
    const month = monthOf(item.at)
    if (groups.at(-1)?.month !== month) groups.push({ month, items: [] })
    groups.at(-1)!.items.push(item)
  }
  return (
    <div className="space-y-4">
      {before && (
        <section aria-label="Upcoming">
          <FeedLabel>Upcoming</FeedLabel>
          <ul className="divide-y divide-border">{before}</ul>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.month} aria-label={g.month}>
          <FeedLabel>{g.month}</FeedLabel>
          <ul className="divide-y divide-border">
            {g.items.map((item) => (
              <FeedRow key={item.key} item={item} name={name} onChanged={onChanged} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export interface NoteComposerHandle {
  focus: () => void
}

/** A box to write a note about the contact, open until it's saved, cancelled or left empty. */
export const NoteComposer = forwardRef<
  NoteComposerHandle,
  {
    email: string
    name: string
    /** The draft, kept by the page so it outlives a change of tab. */
    body: string
    onBody: (body: string) => void
    onAdded: () => void
    onClose: () => void
  }
>(function NoteComposer({ email, name, body, onBody: setBody, onAdded, onClose }, ref) {
  const box = useRef<HTMLTextAreaElement>(null)
  const focus = () => {
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    box.current?.focus({ preventScroll: true })
  }
  useImperativeHandle(ref, () => ({ focus }))
  useEffect(() => {
    focus()
  }, [])
  const add = useMutation({
    mutationFn: () => addNoteFn({ data: { contactEmail: email, body } }),
    onSuccess: () => {
      setBody('')
      onAdded()
      onClose()
    },
  })
  const save = () => {
    if (body.trim() && !add.isPending) add.mutate()
  }
  const cancel = () => {
    setBody('')
    onClose()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onBlur={(e) => {
        if (!body.trim() && !e.currentTarget.contains(e.relatedTarget as Node | null)) onClose()
      }}
      className="mb-2 rounded-xl border border-input bg-card transition-colors focus-within:border-accent"
    >
      <label htmlFor={`note-${email}`} className="sr-only">
        Note about {name}
      </label>
      <textarea
        id={`note-${email}`}
        ref={box}
        value={body}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
          if (e.key === 'Escape') cancel()
        }}
        placeholder={`What should the team know about ${name}?`}
        className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/90"
      />
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {add.error ? <span className="text-destructive">{(add.error as Error).message}</span> : 'Only your team sees notes.'}
        </span>
        <span className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={add.isPending} disabled={!body.trim()}>
            Save note
          </Button>
        </span>
      </div>
    </form>
  )
})
