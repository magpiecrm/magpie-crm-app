import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { Badge } from '../../../components/ui/Badge'
import { Notice } from '../../../components/ui/Notice'
import { Sheet } from '../../../components/ui/Sheet'
import { useConversation } from '../useConversation'
import { Composer, ConversationThread } from './ConversationThread'
import { ENROLLMENT_STATUS } from './labels'

/** One person's whole conversation with a sequence, in a panel: its emails, their replies and the answers, and a box to answer in. */
export function ConversationSheet({ enrollmentId, onClose }: { enrollmentId: string | null; onClose: () => void }) {
  const { conversation, send } = useConversation(enrollmentId)
  const view = conversation.data
  const status = view ? ENROLLMENT_STATUS[view.status] : null
  // Opens at the latest message, and goes to an answer once it's sent.
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [view?.enrollment_id, view?.items.length])

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
      <div className="px-4 py-4">
        {conversation.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {conversation.error && <Notice level="error">{(conversation.error as Error).message}</Notice>}
        {view && <ConversationThread view={view} />}
        <div ref={end} />
      </div>
    </Sheet>
  )
}
