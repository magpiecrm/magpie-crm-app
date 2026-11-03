import { useQuery } from '@tanstack/react-query'
import { warmupStandingFn } from '../../../server/functions'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'

/** How the warmup pool's states read when a sender is in trouble. */
const TROUBLE: Record<string, string> = {
  throttled: "A good share of its warmup is landing in spam, so it's warming at half speed.",
  quarantined: 'The warmup pool has held it for a while after complaints or bounces.',
  blocked: 'The warmup pool has blocked it.',
}

/** Under a campaign's sender: a warning when that sender's warmup is in trouble, so mail from it may well land in spam. */
export function SenderWarmupNote({ email }: { email: string }) {
  const { data } = useQuery({ queryKey: queryKeys.settings.warmupStanding(), queryFn: () => warmupStandingFn(), staleTime: 60_000 })
  const w = data?.senders[email.toLowerCase()]
  if (!w) return null
  const why = w.health ? TROUBLE[w.health.state] : undefined
  if (why) {
    return (
      <Notice level={w.health!.state === 'throttled' ? 'warning' : 'error'} title="This sender's warmup is in trouble">
        {why} Mail from it is likely to land in spam too: send less, or wait until Settings → Warmup shows it healthy again.
      </Notice>
    )
  }
  if (w.problem) {
    return (
      <Notice level="warning" title="This sender's warmup isn't sending">
        {w.problem}
      </Notice>
    )
  }
  return null
}
