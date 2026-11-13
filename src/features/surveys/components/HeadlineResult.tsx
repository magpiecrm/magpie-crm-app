
export type Headline = { kind: 'nps' | 'rating' | 'scale'; value: number; max?: number }

/**
 * A survey's lead result in the list, one figure and one word for every kind:
 * "+47" over "NPS" (signed, as it runs −100 to +100), "4.4 / 5" over
 * "Average" for a rating or a scale. `inline` is the phone's one-line form.
 */
export function HeadlineResult({ headline: h, inline }: { headline: Headline; inline?: boolean }) {
  const value = h.kind === 'nps' ? `${h.value > 0 ? '+' : ''}${h.value}` : h.value.toFixed(1)
  const unit = h.kind === 'nps' ? 'NPS' : `/ ${h.max}`
  const what = h.kind === 'nps' ? 'Net Promoter Score' : h.kind === 'rating' ? 'Average rating' : 'Average score'
  if (inline) {
    return (
      <span className="whitespace-nowrap" title={what}>
        {h.kind === 'nps' && 'NPS '}
        <span className="font-medium tabular-nums text-foreground">{value}</span>
        {h.kind !== 'nps' && ` ${unit}`}
      </span>
    )
  }
  return (
    <>
      <p className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-foreground" title={what}>
        {value}
        {h.kind !== 'nps' && <span className="text-[13px] font-normal text-muted-foreground"> / {h.max}</span>}
      </p>
      <p className="text-[13px] text-muted-foreground">{h.kind === 'nps' ? 'NPS' : 'Average'}</p>
    </>
  )
}
