import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getUsageFn } from '../../../server/functions'

const LABEL = { prospects: 'Prospects', reveals: 'Email reveals', emailsSent: 'Emails sent' } as const

/**
 * This period's allowances as bars, with an Upgrade button, when whoever
 * hosts this copy sells usage up front (see server/allowance.ts). Renders
 * nothing otherwise.
 */
export function AllowanceMeter({ compact = false }: { compact?: boolean }) {
  const { data } = useQuery({ queryKey: queryKeys.settings.usage(), queryFn: () => getUsageFn(), refetchInterval: 60_000 })
  const allowance = data?.allowance
  if (!allowance || allowance.items.length === 0) return null

  const nearlyOut = allowance.items.some((i) => i.used >= i.limit * 0.9)
  const resets = allowance.periodEnd
    ? new Date(allowance.periodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null

  return (
    <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}>
      {!compact && (
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Your plan this month</h3>
          {resets && <span className="text-xs text-muted-foreground">Resets {resets}</span>}
        </div>
      )}
      {allowance.sendingPaused && (
        <p className={`${compact ? 'text-[10px]' : 'text-xs'} font-semibold text-destructive`}>
          Sending is paused by your hosting provider.
        </p>
      )}
      {allowance.items.map(({ kind, used, limit }) => {
        const share = limit > 0 ? Math.min(1, used / limit) : 1
        const out = used >= limit
        return (
          <div key={kind} className="flex flex-col gap-1">
            <div className={`flex justify-between gap-2 ${compact ? 'text-[10px]' : 'text-xs'}`}>
              <span className={out ? 'text-destructive font-semibold' : 'text-foreground'}>{LABEL[kind]}</span>
              <span className="tabular-nums text-muted-foreground">
                {used.toLocaleString()} / {limit.toLocaleString()}
              </span>
            </div>
            <div
              className="h-1.5 rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-label={LABEL[kind]}
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(used, limit)}
            >
              <div
                className={`h-full rounded-full ${out ? 'bg-destructive' : share >= 0.9 ? 'bg-amber-500' : 'bg-accent'}`}
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </div>
        )
      })}
      {allowance.upgradeUrl && (compact ? nearlyOut : true) && (
        <a
          href={allowance.upgradeUrl}
          className={`inline-flex items-center justify-center gap-1 rounded-md-s font-semibold transition-colors ${
            nearlyOut ? 'bg-primary text-primary-foreground hover:bg-primary/85' : 'border border-border text-foreground hover:bg-muted'
          } ${compact ? 'text-[11px] px-2 py-1.5 mt-1' : 'text-sm px-3 py-2 self-start'}`}
        >
          Upgrade <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  )
}
