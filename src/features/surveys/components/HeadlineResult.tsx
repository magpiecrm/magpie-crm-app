import { Star } from 'lucide-react'

export type Headline = { kind: 'nps' | 'rating' | 'scale'; value: number; max?: number }

/**
 * A survey's lead result in the list: its NPS (signed, as it runs -100 to
 * 100), or a rating's average out of its top mark. `inline` is the phone's
 * one-line form.
 */
export function HeadlineResult({ headline: h, inline }: { headline: Headline; inline?: boolean }) {
  const value = h.kind === 'nps' ? `${h.value > 0 ? '+' : ''}${h.value}` : h.value.toFixed(1)
  const label = 'NPS'
  if (inline) {
    return (
      <span className="whitespace-nowrap">
        {h.kind === 'nps' ? 'NPS ' : ''}
        <span className="font-medium tabular-nums text-foreground">{value}</span>
        {h.kind !== 'nps' && ` / ${h.max}`}
      </span>
    )
  }
  return (
    <>
      <p className="inline-flex items-center gap-1 text-[15px] font-semibold tabular-nums text-foreground">
        {h.kind === 'rating' && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-hidden />}
        {value}
      </p>
      <p className="text-[13px] text-muted-foreground">{h.kind === 'nps' ? label : `average out of ${h.max}`}</p>
    </>
  )
}
