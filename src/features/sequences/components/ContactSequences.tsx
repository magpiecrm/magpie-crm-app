import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { enrollmentActionFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
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

/** A contact's sequences on their page: where they are in each, and "they replied" for the ones still going. */
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
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not in any sequence.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link to="/sales/sequences/$id" params={{ id: e.sequence_id }} search={{ tab: 'people' }} className="text-sm font-medium text-foreground hover:text-accent">
                  {e.sequence_name}
                </Link>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {e.sent} of {e.steps} sent
                  {e.next_send_at ? ` · next from ${when(e.next_send_at)}` : ''}
                  {e.replied_at ? ` · replied ${when(e.replied_at)}` : ''}
                  {e.stop_reason ? ` · ${e.stop_reason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={ENROLLMENT_STATUS[e.status].variant}>{ENROLLMENT_STATUS[e.status].label}</Badge>
                {(e.status === 'active' || e.status === 'paused' || e.status === 'finished') && (
                  <Button size="sm" variant="ghost" isLoading={replied.isPending && replied.variables === e.id} onClick={() => replied.mutate(e.id)}>
                    They replied
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
        Add to a sequence
      </Button>
      {adding && <EnrollDialog emails={[email]} onClose={() => setAdding(false)} />}
    </div>
  )
}
