import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { mailboxesFn, sequenceRepliesFn } from '../../../server/functions'
import { Notice } from '../../../components/ui/Notice'
import type { EnrollmentView, Sequence } from '../types'
import { when } from './labels'

/** What a row says when there's no message to show: marked by hand, or found before replies were kept. */
function noText(e: EnrollmentView): string {
  return e.reply?.matched_by === 'manual' ? 'Marked as replied by hand' : 'Replied before replies were kept here: their email is in your inbox'
}

/** Everyone who has replied to a sequence, the latest conversation first; choosing one opens it. */
export function RepliesList({ sequence, onOpen }: { sequence: Sequence; onOpen: (enrollmentId: string) => void }) {
  const { data = [], isLoading } = useQuery({
    queryKey: queryKeys.sequences.replies(sequence.id),
    queryFn: () => sequenceRepliesFn({ data: { id: sequence.id } }),
    refetchInterval: 60_000,
  })
  const { data: boxes } = useQuery({ queryKey: queryKeys.sequences.mailboxes(), queryFn: () => mailboxesFn() })
  const connected = !!boxes?.some((b) => b.sender_id === sequence.sender_id)

  return (
    <div className="space-y-4">
      {boxes && !connected && sequence.sender_id !== null && (
        <Notice
          level="warning"
          title="Replies aren't being read"
          action={
            <Link to="/settings" search={{ tab: 'senders' }} className="text-xs font-semibold text-accent hover:underline">
              Connect the inbox
            </Link>
          }
        >
          This sequence's sender doesn't have its inbox connected, so replies don't show here and don't stop the sequence. Connect it in Settings, under Mailboxes.
        </Notice>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No replies yet. When someone answers one of this sequence's emails, it shows here, and you can answer them back from here too.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {data.map((e) => {
            const who = e.name ?? e.contact_email
            const latest = e.last_message
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onOpen(e.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                >
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.unread ? 'bg-accent' : 'bg-transparent'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`truncate text-sm ${e.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                        {who}
                        {e.company && <span className="font-normal text-muted-foreground"> · {e.company}</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when(latest?.at ?? e.replied_at)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {latest ? (
                        <>
                          {latest.direction === 'out' && <span className="text-foreground/70">You: </span>}
                          {latest.snippet || '(no text)'}
                        </>
                      ) : (
                        noText(e)
                      )}
                    </span>
                  </span>
                  {e.unread > 0 && <span className="sr-only">{e.unread === 1 ? '1 new message' : `${e.unread} new messages`}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
