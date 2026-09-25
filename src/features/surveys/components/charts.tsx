/**
 * Small result charts for the survey summary, in plain HTML.
 *
 * Palette (from the dataviz reference instance): single-series magnitude bars
 * are one hue — blue, with its own dark-mode step. NPS is a polarity split, so
 * it uses the diverging pair: red detractors, neutral-gray passives, blue
 * promoters. Values and labels always wear text colours, never the bar colour,
 * and every bar has a visible number so colour is never the only channel.
 */

const BAR = 'bg-[#2a78d6] dark:bg-[#3987e5]'
const DETRACTOR = 'bg-[#e34948] dark:bg-[#e66767]'
const PASSIVE = 'bg-[#d6d5d0] dark:bg-[#4a4a46]'
const PROMOTER = BAR

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

/** Horizontal bars, one per row, all scaled to the largest value. */
export function BarList({ rows, total }: { rows: Array<{ label: string; count: number }>; total: number }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="space-y-2" role="list">
      {rows.map((row, i) => (
        <div key={i} role="listitem" className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm group">
          <span className="truncate text-foreground" title={row.label}>
            {row.label}
          </span>
          <div className="h-5 bg-muted/40 rounded-r" title={`${row.label}: ${row.count} (${pct(row.count, total)}%)`}>
            <div
              className={`h-full rounded-r ${BAR} transition-[width] duration-300 group-hover:brightness-110`}
              style={{ width: `${(row.count / max) * 100}%`, minWidth: row.count ? 3 : 0 }}
            />
          </div>
          <span className="tabular-nums text-muted-foreground text-xs w-20 text-right">
            <span className="text-foreground font-semibold">{row.count}</span> · {pct(row.count, total)}%
          </span>
        </div>
      ))}
    </div>
  )
}

/** A compact column chart for ordered scales (NPS 0–10, ratings). */
export function Distribution({
  counts,
  start,
  colorFor,
}: {
  counts: number[]
  start: number
  /** Optional per-value class, e.g. NPS bands. */
  colorFor?: (value: number) => string
}) {
  const max = Math.max(1, ...counts)
  return (
    <div className="flex items-end gap-[2px] h-28" role="list">
      {counts.map((count, i) => {
        const value = start + i
        return (
          <div key={value} role="listitem" className="flex-1 flex flex-col items-center gap-1 h-full justify-end group" title={`${value}: ${count}`}>
            <span className="text-[10px] tabular-nums text-muted-foreground">{count || ''}</span>
            <div
              className={`w-full max-w-6 rounded-t ${colorFor?.(value) ?? BAR} group-hover:brightness-110`}
              style={{ height: `${(count / max) * 100}%`, minHeight: count ? 3 : 0 }}
            />
            <span className="text-[10px] tabular-nums text-muted-foreground">{value}</span>
          </div>
        )
      })}
    </div>
  )
}

export const npsBand = (value: number) => (value <= 6 ? DETRACTOR : value <= 8 ? PASSIVE : PROMOTER)

/** Detractor / passive / promoter split as one stacked bar with a text legend. */
export function NpsSplit({ detractors, passives, promoters }: { detractors: number; passives: number; promoters: number }) {
  const total = detractors + passives + promoters
  const parts = [
    { label: 'Detractors (0–6)', count: detractors, cls: DETRACTOR },
    { label: 'Passives (7–8)', count: passives, cls: PASSIVE },
    { label: 'Promoters (9–10)', count: promoters, cls: PROMOTER },
  ]
  return (
    <div className="space-y-2">
      {/* gap-[2px] is the surface spacer between stacked segments */}
      <div className="flex h-5 gap-[2px]">
        {parts.map(
          p =>
            p.count > 0 && (
              <div
                key={p.label}
                title={`${p.label}: ${p.count} (${pct(p.count, total)}%)`}
                className={`${p.cls} h-full first:rounded-l last:rounded-r`}
                style={{ width: `${pct(p.count, total)}%` }}
              />
            ),
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.map(p => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${p.cls}`} aria-hidden />
            {p.label}: <span className="text-foreground font-semibold tabular-nums">{pct(p.count, total)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}
