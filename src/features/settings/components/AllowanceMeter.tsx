import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getUsageFn } from '../../../server/functions'

const LABEL = { prospects: 'Prospect credits', reveals: 'Email reveals', emailsSent: 'Emails' } as const

/**
 * What's left of this period's allowances, as bars that empty as they're
 * used, with an Upgrade button, when whoever hosts this copy sells usage up
 * front (see server/allowance.ts). Renders nothing otherwise.
 */
export function AllowanceMeter({
  compact = false,
  showUpgrade = true,
  heading = true,
  showResets = true,
}: {
  compact?: boolean
  showUpgrade?: boolean
  /** Off where the block around it already says "Your plan" (Settings): only the reset date shows. */
  heading?: boolean
  /** Off where the renewal date is already beside it (Plan and billing). */
  showResets?: boolean
}) {
  const { data } = useQuery({ queryKey: queryKeys.settings.usage(), queryFn: () => getUsageFn(), refetchInterval: 60_000 })
  const allowance = data?.allowance
  if (!allowance || allowance.items.length === 0) return null

  const nearlyOut = allowance.items.some((i) => i.left <= i.limit * 0.1)
  const resets = allowance.periodEnd
    ? new Date(allowance.periodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null

  return (
    <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}>
      {!compact && heading && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Your plan this month</h3>
          {resets && <span className="text-xs text-muted-foreground whitespace-nowrap">Resets {resets}</span>}
        </div>
      )}
      {!compact && !heading && showResets && resets && <p className="text-xs text-muted-foreground">Resets {resets}</p>}
      {allowance.sendingPaused && (
        <p className={`${compact ? 'text-[10px]' : 'text-xs'} font-semibold text-destructive`}>
          Sending is paused by your hosting provider.
        </p>
      )}
      {allowance.items.map(({ kind, left, limit }) => {
        const share = limit > 0 ? left / limit : 0
        const out = left === 0
        return (
          <div key={kind} className="flex flex-col gap-1">
            <div className={`flex justify-between gap-2 ${compact ? 'text-[10px]' : 'text-xs'}`}>
              <span className={out ? 'text-destructive font-semibold' : 'text-foreground'}>{LABEL[kind]}</span>
              <span className="tabular-nums text-muted-foreground">
                {left.toLocaleString()} left{limit > 0 && ` of ${limit.toLocaleString()}`}
              </span>
            </div>
            <div
              className={`h-1.5 rounded-full overflow-hidden ${out ? 'bg-destructive/20' : 'bg-muted'}`}
              role="progressbar"
              aria-label={LABEL[kind]}
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={left}
            >
              <div
                className={`h-full rounded-full ${share <= 0.1 ? 'bg-amber-500' : 'bg-accent'}`}
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </div>
        )
      })}
      {!compact && allowance.revealCredits && (
        <p className="text-xs text-muted-foreground">
          Searching uses prospect credits for what it costs, about 2 for each prospect found. A verified email uses{' '}
          {allowance.revealCredits}.
        </p>
      )}
      {showUpgrade && allowance.upgradeUrl && (compact ? nearlyOut : true) && (
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
