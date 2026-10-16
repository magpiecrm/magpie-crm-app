import { Banknote, Briefcase, Flame, TrendingUp, UserPlus } from 'lucide-react'
import type { Signal, SignalKind } from '../../../server/prospecting/types'

// The intent signals on a search result (server/prospecting/signals.ts), as
// small chips: warm in amber, as it's the workspace's own interest; the rest
// in the accent colour. A chip's tooltip says more; warm links to the company.

const ICON: Record<SignalKind, typeof Flame> = {
  warm: Flame,
  new_in_role: UserPlus,
  hiring: Briefcase,
  funding: Banknote,
  growing: TrendingUp,
}

const TONE: Record<SignalKind, string> = {
  warm: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  new_in_role: 'bg-accent/10 text-accent',
  hiring: 'bg-accent/10 text-accent',
  funding: 'bg-accent/10 text-accent',
  growing: 'bg-accent/10 text-accent',
}

export function SignalBadges({ signals }: { signals?: Signal[] }) {
  if (!signals?.length) return null
  return (
    <span className="flex flex-wrap gap-1 mt-1">
      {signals.map((s) => {
        const Icon = ICON[s.kind]
        const chip = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${TONE[s.kind]}`
        const body = (
          <>
            <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
            {s.label}
          </>
        )
        return s.url ? (
          <a
            key={s.kind}
            href={s.url}
            title={s.detail}
            className={`${chip} hover:underline underline-offset-2`}
            {...(/^https?:/.test(s.url) ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {body}
          </a>
        ) : (
          <span key={s.kind} title={s.detail} className={chip}>
            {body}
          </span>
        )
      })}
    </span>
  )
}
