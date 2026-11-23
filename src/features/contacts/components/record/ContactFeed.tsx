import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { ClipboardList, FileInput, MailOpen, Megaphone, MessageSquareReply, MousePointerClick, PenLine, Send, Trash2, CheckCircle2, type LucideIcon } from 'lucide-react'
import { addNoteFn, deleteNoteFn } from '../../../../server/functions'
import { Avatar } from '../../../../components/ui/Avatar'
import { Button } from '../../../../components/ui/Button'
import { confirmDialog } from '../../../../components/ui/confirm'
import { nameFromEmail } from '../../../sales/utils'
import { formatAgo, formatWhen, monthOf, type FeedItem } from '../../record'

const KIND: Record<FeedItem['kind'], { label: string; Icon: LucideIcon }> = {
  campaign: { label: 'Campaign', Icon: Megaphone },
  sequence: { label: 'Sequence email', Icon: Send },
  form: { label: 'Form', Icon: FileInput },
  survey: { label: 'Survey', Icon: ClipboardList },
  note: { label: 'Note', Icon: PenLine },
}

type Outcome = { text: string; Icon?: LucideIcon; tone: 'good' | 'info' | 'plain' | 'none' }

/** What came of an email, form or survey: the strongest thing they did first. */
function outcome(item: FeedItem): Outcome[] {
  if (item.kind === 'campaign' || item.kind === 'sequence') {
    if (item.replied) return [{ text: 'Replied', Icon: MessageSquareReply, tone: 'good' }]
    if (item.clicked) return [{ text: 'Clicked', Icon: MousePointerClick, tone: 'info' }]
    if (item.opened) return [{ text: 'Opened', Icon: MailOpen, tone: 'plain' }]
    return [{ text: 'Not opened', tone: 'none' }]
  }
  if (item.kind === 'survey') return item.completed ? [{ text: 'Completed', Icon: CheckCircle2, tone: 'good' }] : [{ text: 'Not finished', tone: 'none' }]
  if (item.kind === 'form') return [{ text: 'Submitted', Icon: CheckCircle2, tone: 'plain' }]
  return []
}

const CHIP: Record<Outcome['tone'], string> = {
  good: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  info: 'bg-accent/10 text-accent',
  plain: 'bg-foreground/[0.07] text-foreground/80',
  none: 'text-muted-foreground',
}

function When({ at }: { at: string }) {
  return (
    <time dateTime={at} title={formatWhen(at)} className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
      {formatAgo(at)}
    </time>
  )
}

function FeedRow({ item, onChanged }: { item: FeedItem; onChanged: () => void }) {
  const { label, Icon } = KIND[item.kind]
  const remove = useMutation({ mutationFn: (id: string) => deleteNoteFn({ data: { id } }), onSuccess: onChanged })
  const author = item.note?.created_by ? nameFromEmail(item.note.created_by) : null

  return (
    <li className="group relative flex gap-3 py-3">
      {author ? (
        <span className="mt-0.5">
          <Avatar name={author} />
        </span>
      ) : (
        <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
      )}
      {item.note ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {author ?? 'Someone'}
              <span className="font-normal text-muted-foreground"> wrote a note</span>
            </p>
            <span className="flex shrink-0 items-baseline gap-2">
              <button
                type="button"
                aria-label="Delete note"
                title="Delete note"
                onClick={async () => {
                  const ok = await confirmDialog({ title: 'Delete this note?', message: 'It can’t be brought back.', confirmLabel: 'Delete note', tone: 'danger' })
                  if (ok) remove.mutate(item.note!.id)
                }}
                disabled={remove.isPending}
                className="touch-target self-center rounded-md-xs p-0.5 text-muted-foreground transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </button>
              <When at={item.at} />
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 text-sm leading-6 text-foreground">{item.note.body}</p>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            {item.url ? (
              <Link to={item.url} className="min-w-0 truncate text-sm font-medium text-foreground hover:text-accent">
                {item.title}
              </Link>
            ) : (
              <p className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</p>
            )}
            <When at={item.at} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            <span>{label}</span>
            {outcome(item).map((o) => (
              <span key={o.text} className={`inline-flex items-center gap-1 rounded-full text-xs font-medium ${o.tone === 'none' ? '' : 'px-2 py-0.5'} ${CHIP[o.tone]}`}>
                {o.Icon && <o.Icon aria-hidden className="h-3 w-3" />}
                {o.text}
              </span>
            ))}
          </p>
        </div>
      )}
    </li>
  )
}

/** A contact's history as one list; `months` puts a heading over each month. */
export function FeedList({ items, months = false, onChanged }: { items: FeedItem[]; months?: boolean; onChanged: () => void }) {
  if (!months) {
    return (
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <FeedRow key={item.key} item={item} onChanged={onChanged} />
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
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.month} aria-label={g.month}>
          <h3 className="border-b border-border pb-2 text-xs font-medium text-muted-foreground">{g.month}</h3>
          <ul className="divide-y divide-border">
            {g.items.map((item) => (
              <FeedRow key={item.key} item={item} onChanged={onChanged} />
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

/** A box to write a note about the contact; its buttons show once there's something to save. */
export const NoteComposer = forwardRef<NoteComposerHandle, { email: string; name: string; onAdded: () => void }>(function NoteComposer(
  { email, name, onAdded },
  ref,
) {
  const [body, setBody] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({
    focus: () => {
      setOpen(true)
      box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      box.current?.focus({ preventScroll: true })
    },
  }))
  const add = useMutation({
    mutationFn: () => addNoteFn({ data: { contactEmail: email, body } }),
    onSuccess: () => {
      setBody('')
      setOpen(false)
      onAdded()
    },
  })
  const save = () => {
    if (body.trim() && !add.isPending) add.mutate()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="rounded-xl border border-input bg-card transition-colors focus-within:border-accent"
    >
      <label htmlFor={`note-${email}`} className="sr-only">
        Note about {name}
      </label>
      <textarea
        id={`note-${email}`}
        ref={box}
        value={body}
        rows={open || body ? 3 : 1}
        onFocus={() => setOpen(true)}
        onBlur={() => !body.trim() && setOpen(false)}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
          if (e.key === 'Escape' && !body.trim()) box.current?.blur()
        }}
        placeholder={`Add a note about ${name}…`}
        className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/90"
      />
      {(open || body) && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {add.error ? <span className="text-destructive">{(add.error as Error).message}</span> : 'Only your team sees notes.'}
          </span>
          <Button type="submit" size="sm" isLoading={add.isPending} disabled={!body.trim()}>
            Save note
          </Button>
        </div>
      )}
    </form>
  )
})
