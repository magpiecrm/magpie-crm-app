import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, MessageSquareReply, Pause, Play, Plus, UserMinus } from 'lucide-react'
import { enrollmentActionFn } from '../../../server/functions'
import { ActionMenu, type ActionMenuItem } from '../../../components/ui/ActionMenu'
import { Badge } from '../../../components/ui/Badge'
import { confirmDialog } from '../../../components/ui/confirm'
import { Section, SECTION_ACTION } from '../../../components/ui/RecordSection'
import { queryKeys } from '../../../queryKeys'
import { EnrollDialog } from './EnrollDialog'
import { ENROLLMENT_STATUS, when } from './labels'
import type { EnrollmentStatus } from '../types'

export interface ContactSequence {
  id: string
  sequence_id: string
  sequence_name: string
  steps: number
  status: EnrollmentStatus
  stop_reason: string | null
  sent: number
  next_send_at: string | null
  replied_at: string | null
}

/** How far through the sequence they are: one dot per email, filled once it's sent. */
function Steps({ sent, steps }: { sent: number; steps: number }) {
  return (
    <span aria-hidden className="inline-flex items-center gap-1">
      {Array.from({ length: steps }, (_, i) => (
        <span key={i} className={`h-1.5 w-5 rounded-full ${i < sent ? 'bg-accent' : 'bg-foreground/30'}`} />
      ))}
    </span>
  )
}

/** A contact's sequences on their page: where they are in each, their reply, and "they replied" for the ones still going. */
export function ContactSequences({
  email,
  items,
  blocked = null,
}: {
  email: string
  items: ContactSequence[]
  /** Why they can't be added to one (they unsubscribed), if they can't. */ blocked?: string | null
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'mark_replied' | 'stop' | 'remove' }) =>
      enrollmentActionFn({ data: { ids: [id], action } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.contact(email) })
      void queryClient.invalidateQueries({ queryKey: ['sequences'] })
    },
  })
  return (
    <Section
      title="Sequences"
      count={items.length || undefined}
      action={
        !blocked && (
          <button type="button" onClick={() => setAdding(true)} className={SECTION_ACTION}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Add to sequence
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{blocked ?? 'Not in any sequence.'}</p>
      ) : (
        <ul className="-mt-1 divide-y divide-border">
          {items.map((e) => {
            const status = ENROLLMENT_STATUS[e.status]
            const going = e.status === 'active' || e.status === 'paused' || e.status === 'finished'
            const items: ActionMenuItem[] = [
              ...(e.status === 'active' ? [{ label: 'Pause for them', icon: Pause, onSelect: () => act.mutate({ id: e.id, action: 'pause' }) }] : []),
              ...(e.status === 'paused' ? [{ label: 'Resume', icon: Play, onSelect: () => act.mutate({ id: e.id, action: 'resume' }) }] : []),
              ...(going && !e.replied_at ? [{ label: 'Mark as replied', icon: Check, onSelect: () => act.mutate({ id: e.id, action: 'mark_replied' }) }] : []),
              ...(going && !e.replied_at && (e.sent === 0 || e.status === 'active' || e.status === 'paused') ? (['separator'] as ActionMenuItem[]) : []),
              // Taken out only before anything went to them; after that, stopped.
              ...(e.sent === 0 || e.status === 'active' || e.status === 'paused'
                ? [
                    {
                      label: e.sent === 0 ? 'Remove from sequence' : 'Stop sending to them',
                      icon: e.sent === 0 ? UserMinus : Ban,
                      tone: 'danger' as const,
                      onSelect: async () => {
                        const ok = await confirmDialog({
                          title: e.sent === 0 ? `Remove them from ${e.sequence_name}?` : `Stop ${e.sequence_name} for them?`,
                          message:
                            e.sent === 0
                              ? 'Nothing has gone to them yet, so nothing will.'
                              : 'No more of its emails go to them. What was sent stays in their activity.',
                          confirmLabel: e.sent === 0 ? 'Remove' : 'Stop sending',
                          tone: 'danger',
                        })
                        if (ok) act.mutate({ id: e.id, action: e.sent === 0 ? 'remove' : 'stop' })
                      },
                    },
                  ]
                : []),
            ]
            return (
              <li key={e.id} className="flex items-center justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/sales/sequences/$id"
                      params={{ id: e.sequence_id }}
                      search={{ tab: 'people' }}
                      className="text-sm font-medium text-foreground hover:text-accent"
                    >
                      {e.sequence_name}
                    </Link>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
                    <Steps sent={e.sent} steps={e.steps} />
                    <span>
                      {e.sent} of {e.steps} sent
                      {e.next_send_at ? ` · next ${when(e.next_send_at)}` : ''}
                      {e.stop_reason && !e.replied_at ? ` · ${e.stop_reason}` : ''}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {e.replied_at && (
                    <Link to="/sales/sequences/$id" params={{ id: e.sequence_id }} search={{ tab: 'replies', person: e.id }} className={SECTION_ACTION}>
                      <MessageSquareReply aria-hidden className="h-3.5 w-3.5" />
                      View reply
                    </Link>
                  )}
                  {items.length > 0 && (
                    <ActionMenu
                      label={`Actions for ${e.sequence_name}`}
                      triggerClassName="inline-flex h-7 w-7 items-center justify-center rounded-md-xs text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      items={items}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {adding && <EnrollDialog emails={[email]} onClose={() => setAdding(false)} />}
    </Section>
  )
}
