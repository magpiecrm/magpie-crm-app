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
import { nameFromEmail } from '../../../sales/utils'
import { formatAgo, formatWhen, monthOf, type FeedItem } from '../../record'

const KIND: Record<Exclude<FeedItem['kind'], 'note' | 'reply'>, { label: string; Icon: LucideIcon }> = {
  campaign: { label: 'Campaign', Icon: Megaphone },
  sequence: { label: 'Sequence email', Icon: Send },
  form: { label: 'Form', Icon: FileInput },
  survey: { label: 'Survey', Icon: ClipboardList },
}

type Tone = 'success' | 'info' | 'neutral' | 'quiet'

/** What came of an email, form or survey: the strongest thing they did. */
function outcome(item: FeedItem): { text: string; Icon: LucideIcon; tone: Tone } | null {
  if (item.kind === 'campaign' || item.kind === 'sequence') {
    if (item.replied) return { text: 'Replied', Icon: MessageSquareReply, tone: 'success' }
    if (item.clicked) return { text: 'Clicked', Icon: MousePointerClick, tone: 'info' }
    if (item.opened) return { text: 'Opened', Icon: MailOpen, tone: 'neutral' }
    return { text: 'Not opened', Icon: CircleDashed, tone: 'quiet' }
  }
  if (item.kind === 'survey') return item.completed ? { text: 'Completed', Icon: CheckCircle2, tone: 'success' } : { text: 'Not finished', Icon: CircleDashed, tone: 'quiet' }
  if (item.kind === 'form') return { text: 'Submitted', Icon: CheckCircle2, tone: 'success' }
  return null
}

/** One look for a state wherever the page shows it: a soft pill with an icon and a word. */
const CHIP_TONE: Record<Tone, string> = {
  success: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  info: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  neutral: 'bg-foreground/[0.07] text-foreground/80',
  quiet: 'border border-dashed border-foreground/30 text-muted-foreground',
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

function Bubble({ children, tone = 'note' }: { children: React.ReactNode; tone?: 'note' | 'reply' }) {
  return (
    <p
      className={`mt-1.5 whitespace-pre-wrap break-words rounded-r-lg border-l-2 bg-muted/60 px-3 py-2 text-sm leading-6 text-foreground dark:bg-white/[0.05] ${
        tone === 'reply' ? 'border-emerald-500/70' : 'border-accent/60'
      }`}
    >
      {children}
    </p>
  )
}

function IconDot({ Icon, tone }: { Icon: LucideIcon; tone?: 'reply' }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
        tone === 'reply' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border bg-background text-muted-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
    </span>
  )
}

function NoteRow({ item, onChanged }: { item: FeedItem; onChanged: () => void }) {
  const note = item.note!
  const author = note.created_by ? nameFromEmail(note.created_by) : null
  const remove = useMutation({ mutationFn: () => deleteNoteFn({ data: { id: note.id } }), onSuccess: onChanged })
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
                    const ok = await confirmDialog({ title: 'Delete this note?', message: 'It can’t be brought back.', confirmLabel: 'Delete note', tone: 'danger' })
                    if (ok) remove.mutate()
                  },
                },
              ]}
            />
          </span>
        </div>
        <Bubble>{note.body}</Bubble>
      </div>
    </>
  )
}

function ReplyRow({ item, name }: { item: FeedItem; name: string }) {
  const r = item.reply!
  return (
    <>
      <IconDot Icon={MessageSquareReply} tone="reply" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-sm text-foreground">
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground"> replied to </span>
            <span className="font-medium">{r.sequence_name}</span>
          </p>
          <When at={item.at} />
        </div>
        <Bubble tone="reply">
          {r.excerpt}
          {r.excerpt.length >= 280 ? '…' : ''}
        </Bubble>
        <Link
          to="/sales/sequences/$id"
          params={{ id: r.sequence_id }}
          search={{ tab: 'replies', person: r.enrollment_id }}
          className="mt-1.5 -ml-1.5 inline-flex items-center gap-1 rounded-md-xs px-1.5 py-1 text-[13px] font-medium text-accent hover:bg-accent/10"
        >
          Open the conversation
        </Link>
      </div>
    </>
  )
}

function EventRow({ item }: { item: FeedItem }) {
  const { label, Icon } = KIND[item.kind as keyof typeof KIND]
  const result = outcome(item)
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconDot Icon={Icon} />
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
          <dl className="mt-2 space-y-2.5 rounded-lg border border-border px-3 py-2.5">
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
      {item.kind === 'note' ? <NoteRow item={item} onChanged={onChanged} /> : item.kind === 'reply' ? <ReplyRow item={item} name={name} /> : <EventRow item={item} />}
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
      {groups.map((g) => (
        <section key={g.month} aria-label={g.month}>
          <h3 className="border-b border-border pb-2 text-sm font-semibold text-foreground">{g.month}</h3>
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
export const NoteComposer = forwardRef<NoteComposerHandle, { email: string; name: string; onAdded: () => void; onClose: () => void }>(function NoteComposer(
  { email, name, onAdded, onClose },
  ref,
) {
  const [body, setBody] = useState('')
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
