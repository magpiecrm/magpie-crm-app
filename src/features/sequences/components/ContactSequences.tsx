import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquareReply, Plus } from 'lucide-react'
import { enrollmentActionFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
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
        <span key={i} className={`h-1.5 w-4 rounded-full ${i < sent ? 'bg-accent' : 'bg-foreground/15'}`} />
      ))}
    </span>
  )
}

/** A contact's sequences on their page: where they are in each, their reply, and "they replied" for the ones still going. */
export function ContactSequences({ email, items }: { email: string; items: ContactSequence[] }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const replied = useMutation({
    mutationFn: (id: string) => enrollmentActionFn({ data: { ids: [id], action: 'mark_replied' } }),
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
        <button type="button" onClick={() => setAdding(true)} className={SECTION_ACTION}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Add to sequence
        </button>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not in any sequence.</p>
      ) : (
        <ul className="-mt-1 divide-y divide-border">
          {items.map((e) => {
            const status = ENROLLMENT_STATUS[e.status]
            const going = e.status === 'active' || e.status === 'paused' || e.status === 'finished'
            return (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/sales/sequences/$id" params={{ id: e.sequence_id }} search={{ tab: 'people' }} className="text-sm font-medium text-foreground hover:text-accent">
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
                <div className="flex items-center gap-1">
                  {e.replied_at ? (
                    <Link
                      to="/sales/sequences/$id"
                      params={{ id: e.sequence_id }}
                      search={{ tab: 'replies', person: e.id }}
                      className="inline-flex items-center gap-1.5 rounded-md-xs px-2 py-1.5 text-[13px] font-medium text-accent hover:bg-accent/10"
                    >
                      <MessageSquareReply aria-hidden className="h-3.5 w-3.5" />
                      View reply
                    </Link>
                  ) : (
                    going && (
                      <Button size="sm" variant="ghost" isLoading={replied.isPending && replied.variables === e.id} onClick={() => replied.mutate(e.id)}>
                        Mark as replied
                      </Button>
                    )
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
