import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { getUsageFn } from '../../../server/functions'

/**
 * How much of this period's AI budget the copilot has used, as a bar that
 * fills from 0 to 100%, where the host runs the copilot and sells the budget
 * (see server/copilot/managedAi.ts). Renders nothing otherwise.
 */
export function AiBudgetMeter({ label = 'AI budget' }: { label?: string }) {
  const { data } = useQuery({ queryKey: queryKeys.settings.usage(), queryFn: () => getUsageFn(), refetchInterval: 60_000 })
  const ai = data?.allowance?.ai
  // No budget at all says so where it matters (Settings → Copilot), not as a full bar.
  if (!ai || ai.none) return null
  const high = ai.percent >= 90

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className={ai.out ? 'text-destructive font-semibold' : 'text-foreground'}>{label}</span>
        <span className="tabular-nums text-muted-foreground">{ai.percent}% used</span>
      </div>
      <div
        className={`h-1.5 rounded-full overflow-hidden ${ai.out ? 'bg-destructive/20' : 'bg-foreground/10'}`}
        role="progressbar"
        aria-label="AI budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ai.percent}
      >
        <div className={`h-full rounded-full ${ai.out ? 'bg-destructive' : high ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: `${ai.percent}%` }} />
      </div>
    </div>
  )
}
