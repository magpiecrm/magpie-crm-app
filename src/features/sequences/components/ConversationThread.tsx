import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Paperclip, Send } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { splitQuoted } from '../quote'
import type { ConversationItem, ConversationView } from '../types'
import type { useConversation } from '../useConversation'
import { when } from './labels'

// One person's conversation with a sequence, as both the inbox and the
// sequence's Replies panel show it: the emails both ways, and the box to
// answer in.

const topic = (subject: string) => subject.replace(/^(\s*(re|fwd?)\s*:\s*)+/i, '').trim().toLowerCase()

/** Who it's from and what it is, above a message. */
function label(item: ConversationItem): string | null {
  if (item.kind === 'step') return item.step ? `Email ${item.step} of the sequence` : 'A sequence email'
  if (item.direction === 'in') return null
  return item.via === 'inbox' ? 'Sent from your inbox' : 'Sent from here'
}

/** Things to know about a message, under it. */
function notes(item: ConversationItem): string[] {
  const out: string[] = []
  if (item.kind === 'step' && !item.text) out.push("Its step has since been taken out of the sequence, so its words can't be shown.")
  else if (item.edited_since) out.push('The step has been edited since this went out, so these may not be exactly the words they got.')
  if (item.uncertain) out.push('This may not have gone out: the app restarted while sending it.')
  if (item.kind === 'message' && !item.text) out.push("Its text couldn't be read. It's in your inbox.")
  if (item.truncated) out.push('Long email: the rest is in your inbox.')
  if (item.attachments) out.push(`${item.attachments === 1 ? '1 attachment' : `${item.attachments} attachments`}, not kept here. Open it in your inbox to see ${item.attachments === 1 ? 'it' : 'them'}.`)
  if (item.sent_copy === false) out.push("A copy couldn't be put in your inbox's Sent folder.")
  return out
}

/** A message in the thread. The sequence's own emails fold to a line, since they're what the person is answering. */
function Message({ item, showSubject }: { item: ConversationItem; showSubject: boolean }) {
  const [open, setOpen] = useState(item.kind !== 'step')
  const [quoted, setQuoted] = useState(false)
  const split = splitQuoted(item.text)
  const kind = label(item)
  const theirs = item.direction === 'in'
  const header = (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {item.from}
        {kind && <span className="font-normal text-muted-foreground"> · {kind}</span>}
      </span>
      <time dateTime={item.at} className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {when(item.at)}
      </time>
    </span>
  )
  return (
    <article className={`rounded-lg border p-3 sm:p-4 ${theirs ? 'border-accent/30 bg-accent/5' : 'border-border bg-card'}`}>
      {item.kind === 'step' ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2 text-left cursor-pointer">
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1">
            <span className="flex">{header}</span>
            {!open && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[item.subject, item.text.replace(/\s+/g, ' ').slice(0, 160)].filter(Boolean).join(' — ')}</span>}
          </span>
        </button>
      ) : (
        <header className="flex">{header}</header>
      )}
      {open && (
        <>
          {showSubject && item.subject && <p className="mt-1 text-xs text-muted-foreground break-words">{item.subject}</p>}
          {split.body && <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{split.body}</div>}
          {split.quoted && (
            <>
              <button type="button" onClick={() => setQuoted((q) => !q)} aria-expanded={quoted} className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                {quoted ? 'Hide quoted text' : 'Show quoted text'}
              </button>
              {quoted && <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">{split.quoted}</div>}
            </>
          )}
          {notes(item).map((n) => (
            <p key={n} className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              {!!item.attachments && n.includes('attachment') ? <Paperclip className="mt-0.5 h-3 w-3 shrink-0" /> : null}
              {n}
            </p>
          ))}
        </>
      )}
    </article>
  )
}

/** Why none of their words show, under the thread. */
function missingReply(view: ConversationView): string | null {
  const who = view.name ?? view.contact_email
  switch (view.missing_reply) {
    case 'pending':
      return view.inbox_connected
        ? `${who} replied before replies' words were kept here. Their reply is read from the connected inbox shortly.`
        : `${who} replied before replies' words were kept here. Their reply shows once the sender's inbox is connected.`
    case 'not_found':
      return `${who}'s reply came before replies' words were kept here, and it wasn't found in the connected inbox. It may be in another folder.`
    case 'manual':
      return 'Marked as replied by hand, so there is no email of theirs to show.'
    default:
      return null
  }
}

/** The conversation's emails, oldest first, and what to know about them. */
export function ConversationThread({ view }: { view: ConversationView }) {
  const items = view.items
  const missing = missingReply(view)
  return (
    <div className="space-y-3">
      {!view.inbox_connected && (
        <Notice level="warning">
          {view.sender ? `${view.sender.email}'s` : "The sender's"} inbox isn't connected, so new replies won't show here.{' '}
          <Link to="/settings" search={{ tab: 'senders' }} className="font-semibold text-accent hover:underline">
            Connect it
          </Link>
        </Notice>
      )}
      {items.map((item, i) => (
        <Message key={item.key} item={item} showSubject={i === 0 || topic(item.subject) !== topic(items[i - 1].subject)} />
      ))}
      {missing && <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{missing}</p>}
    </div>
  )
}

/** The answer box: what you write, the sign-off that goes under it, and Send. Ctrl or ⌘ + Enter sends it. */
export function Composer({ view, send }: { view: ConversationView; send: ReturnType<typeof useConversation>['send'] }) {
  const [text, setText] = useState('')
  const firstName = view.name?.split(' ')[0] ?? view.contact_email
  const submit = () => {
    if (!text.trim() || send.isPending) return
    send.mutate(text, { onSuccess: () => setText('') })
  }
  if (view.cannot_reply) return <p className="text-sm text-muted-foreground">{view.cannot_reply}</p>
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">Answer {firstName}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={4}
          className={`${INPUT_CLASS} resize-y leading-relaxed`}
        />
      </label>
      {send.error && <Notice level="error">{(send.error as Error).message}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {view.sender ? `From ${view.sender.email}, in the same thread` : null}
          {view.signature ? `, signed "${view.signature.split('\n')[0]}"` : null}
        </p>
        <Button type="submit" size="sm" leftIcon={<Send className="h-4 w-4" />} isLoading={send.isPending} disabled={!text.trim()}>
          Send
        </Button>
      </div>
    </form>
  )
}
