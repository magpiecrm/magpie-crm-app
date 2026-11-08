import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, RotateCcw } from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { Composer, ConversationThread } from '../../sequences/components/ConversationThread'
import { useConversation } from '../../sequences/useConversation'
import { DealLink } from './DealLink'

/** One conversation in the inbox: who it's with and their deal, the emails both ways, and an answer in the same thread. */
export function Conversation({ id, onBack }: { id: string; onBack: () => void }) {
  const { conversation, send, done, viewOnly, refresh } = useConversation(id)
  const view = conversation.data

  // The latest message in view when it opens, and when one is added.
  const thread = useRef<HTMLDivElement>(null)
  const count = view?.items.length ?? 0
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight
  }, [id, count])

  if (conversation.isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>
  if (conversation.error || !view) return <p className="p-6 text-sm text-destructive">{(conversation.error as Error | null)?.message ?? 'Conversation not found'}</p>
  const name = view.name ?? view.contact_email
  const about = [view.title, view.company].filter(Boolean).join(' at ')

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-3 lg:px-6">
        <button onClick={onBack} aria-label="Back to the conversations" className="md:hidden touch-target -ml-2 flex items-center justify-center rounded-md-s p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        {/* At least this wide, so the deal and buttons wrap under the name before squeezing it out. */}
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
          <Avatar name={name} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{name}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {about ? `${about} · ` : ''}
              <Link to="/marketing/contacts" search={{ contact: view.contact_email }} className="hover:text-accent">
                {view.contact_email}
              </Link>
            </p>
          </div>
        </div>
        {!viewOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <DealLink deal={view.deal} email={view.contact_email} companyId={view.company_id} onChanged={refresh} />
            {view.needs_reply ? (
              <Button variant="ghost" size="sm" leftIcon={<Check className="h-4 w-4" />} onClick={() => done.mutate(true)} disabled={done.isPending}>
                Mark as done
              </Button>
            ) : view.done ? (
              <Button variant="ghost" size="sm" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => done.mutate(false)} disabled={done.isPending}>
                Needs a reply
              </Button>
            ) : null}
          </div>
        )}
      </header>

      <div ref={thread} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-background px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-3xl space-y-3">
          <p className="text-xs text-muted-foreground">
            From the sequence{' '}
            <Link to="/sales/sequences/$id" params={{ id: view.sequence_id }} className="text-foreground hover:underline">
              {view.sequence_name}
            </Link>
          </p>
          <ConversationThread view={view} />
        </div>
      </div>

      {!viewOnly && (
        <div className="border-t border-border bg-card px-4 py-3 lg:px-6">
          <div className="mx-auto max-w-3xl">
            <Composer key={id} view={view} send={send} />
          </div>
        </div>
      )}
    </>
  )
}
