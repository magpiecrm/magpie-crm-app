import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Paperclip, Send } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { Sheet } from '../../../components/ui/Sheet'
import { splitQuoted } from '../quote'
import type { ConversationItem, ConversationView } from '../types'
import { useConversation } from '../useConversation'
import { ENROLLMENT_STATUS, when } from './labels'

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

function Message({ item, showSubject }: { item: ConversationItem; showSubject: boolean }) {
  const [quoted, setQuoted] = useState(false)
  const split = splitQuoted(item.text)
  const kind = label(item)
  const theirs = item.direction === 'in'
  return (
    <article className={`rounded-lg border p-3 sm:p-4 ${theirs ? 'border-accent/30 bg-accent/5' : 'border-border bg-card'}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">
          {item.from}
          {kind && <span className="font-normal text-muted-foreground"> · {kind}</span>}
        </p>
        <time dateTime={item.at} className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {when(item.at)}
        </time>
      </header>
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
    </article>
  )
}

/** The answer box: what you write, the sign-off that goes under it, and Send. */
function Composer({ view, send }: { view: ConversationView; send: ReturnType<typeof useConversation>['send'] }) {
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
          {view.sender ? `From ${view.sender.email}` : null}
          {view.signature ? `, signed "${view.signature.split('\n')[0]}"` : null}
        </p>
        <Button type="submit" size="sm" leftIcon={<Send className="h-4 w-4" />} isLoading={send.isPending} disabled={!text.trim()}>
          Send
        </Button>
      </div>
    </form>
  )
}

/** One person's whole conversation with a sequence, in a panel: its emails, their replies and the answers, and a box to answer in. */
export function ConversationSheet({ sequenceId, enrollmentId, onClose }: { sequenceId: string; enrollmentId: string | null; onClose: () => void }) {
  const { conversation, send } = useConversation(sequenceId, enrollmentId)
  const view = conversation.data
  const status = view ? ENROLLMENT_STATUS[view.status] : null
  const items = view?.items ?? []
  // Opens at the latest message, and goes to an answer once it's sent.
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [view?.enrollment_id, items.length])

  return (
    <Sheet
      isOpen={!!enrollmentId}
      onClose={onClose}
      side="right"
      wide
      title={
        view ? (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-base font-bold text-foreground">{view.name ?? view.contact_email}</h3>
              {status && <Badge variant={status.variant}>{status.label}</Badge>}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              <Link to="/marketing/contacts" search={{ contact: view.contact_email }} className="hover:text-accent">
                {view.contact_email}
              </Link>
              {view.company ? ` · ${view.company}` : ''}
            </p>
          </div>
        ) : (
          'Conversation'
        )
      }
      footer={view ? <Composer key={view.enrollment_id} view={view} send={send} /> : undefined}
    >
      <div className="space-y-3 px-4 py-4">
        {conversation.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {conversation.error && <Notice level="error">{(conversation.error as Error).message}</Notice>}
        {view && !view.inbox_connected && (
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
        <div ref={end} />
      </div>
    </Sheet>
  )
}
