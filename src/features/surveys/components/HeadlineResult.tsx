import { Gauge, SlidersHorizontal, Star } from 'lucide-react'

export type Headline = { kind: 'nps' | 'rating' | 'scale'; value: number; max?: number }

const ICON = { nps: Gauge, rating: Star, scale: SlidersHorizontal } as const

/**
 * A survey's lead result in the list, in one format for every kind and size:
 * "+47 NPS" (signed, as it runs −100 to +100), "4.4 / 5" for a rating or a
 * scale's average, each after its type's icon. `inline` is the phone's
 * one-line form of the same thing.
 */
export function HeadlineResult({ headline: h, inline }: { headline: Headline; inline?: boolean }) {
  const Icon = ICON[h.kind]
  const value = h.kind === 'nps' ? `${h.value > 0 ? '+' : ''}${h.value}` : h.value.toFixed(1)
  const unit = h.kind === 'nps' ? 'NPS' : `/ ${h.max}`
  const what = h.kind === 'nps' ? 'Net Promoter Score' : h.kind === 'rating' ? 'Average rating' : 'Average score'
  const icon = <Icon className={`h-3.5 w-3.5 shrink-0 ${h.kind === 'rating' ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'}`} aria-hidden />
  if (inline) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap" title={what}>
        {icon}
        <span className="font-medium tabular-nums text-foreground">{value}</span> {unit}
      </span>
    )
  }
  return (
    <>
      <p className="inline-flex items-center gap-1.5 whitespace-nowrap text-[15px] tabular-nums text-foreground" title={what}>
        {icon}
        <span className="font-semibold">{value}</span>
        <span className="text-[13px] text-muted-foreground">{unit}</span>
      </p>
      <p className="text-[13px] text-muted-foreground">{h.kind === 'nps' ? 'from −100 to +100' : 'average'}</p>
    </>
  )
}
