import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Hourglass, Loader2, Send } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { sendHeldRecipientsFn } from '../../../server/functions'
import type { GuessHold } from '../../../server/db'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const people = (n: number) => `${n} recipient${n === 1 ? '' : 's'}`

/**
 * A sent campaign's unverified recipients held back after a first batch
 * (server/guessedRecipients.ts): when they go, or why they didn't and a way
 * to send them anyway.
 */
export function HeldBackBanner({ campaignId, hold }: { campaignId: number; hold: GuessHold }) {
  const queryClient = useQueryClient()
  const send = useMutation({
    mutationFn: () => sendHeldRecipientsFn({ data: { id: campaignId } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.campaign(String(campaignId)) })
      queryClient.invalidateQueries({ queryKey: queryKeys.email.campaigns() })
    },
  })
  if (hold.status === 'released') return null
  const stopped = hold.status === 'stopped'

  return (
    <div
      className={`mb-6 rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${stopped ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-muted/30'}`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {stopped ? (
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        ) : (
          <Hourglass className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {stopped ? `${people(hold.held)} with unverified addresses weren't sent` : `${people(hold.held)} with unverified addresses held back`}
          </p>
          <p className="text-xs text-muted-foreground">
            {stopped
              ? `${hold.hard_bounces ?? 0} of the first ${hold.first_batch} bounced. Sending the rest risks more bounces, which can hurt the delivery of all your campaigns.`
              : `The first ${hold.first_batch} went out with everyone else. The rest follow from ${when(hold.release_at)}, once their bounces are in, unless more than ${+((hold.max_bounce_rate ?? 0.02) * 100).toFixed(1)}% of those bounce.`}
          </p>
          {send.error && <p className="text-xs text-destructive mt-1">{(send.error as Error).message}</p>}
        </div>
      </div>
      <button
        onClick={() => {
          const ask = stopped
            ? `Send to the ${people(hold.held)} anyway? Their addresses weren't verified and more may bounce.`
            : `Send to the ${people(hold.held)} now, without waiting to see how many of the first batch bounce?`
          if (confirm(ask)) send.mutate()
        }}
        disabled={send.isPending}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50 shrink-0"
      >
        {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {stopped ? 'Send anyway' : 'Send now'}
      </button>
    </div>
  )
}
