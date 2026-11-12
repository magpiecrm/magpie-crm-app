/**
 * Small result charts for the survey summary, in plain HTML.
 *
 * Colour is kept for meaning. A question's counts are one series of plain
 * magnitude, so they're drawn in one neutral ink. NPS is a polarity split, so
 * it alone gets colour, the diverging pair checked with the dataviz validator
 * in both themes: red detractors, a neutral grey midpoint for passives, the
 * app's teal (stepped up for chroma) for promoters. Values and labels always
 * wear text colours, and every bar has its number beside or above it, so
 * colour is never the only channel.
 */

export const BAR = 'bg-[#4b5262] dark:bg-[#aeb4bf]'
const DETRACTOR = 'bg-[#d6453d] dark:bg-[#e8615a]'
const PASSIVE = 'bg-[#a8a7a1] dark:bg-[#64635d]'
const PROMOTER = 'bg-[#0a87a0] dark:bg-[#26a6b8]'
export const TRACK = 'bg-foreground/[0.06] dark:bg-foreground/[0.1]'

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

/**
 * Horizontal bars, one per row, each its share of everyone who answered, on a
 * track that is 100%; the label column is the same width on every card, so
 * bars line up down the page.
 */
export function BarList({ rows, total }: { rows: Array<{ label: string; count: number; note?: string }>; total: number }) {
  const labelWidth = '14rem'
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, i) => (
        <li key={i} className="grid items-center gap-x-3 gap-y-1 text-sm max-sm:grid-cols-[minmax(0,1fr)_auto] sm:[grid-template-columns:var(--label)_minmax(0,1fr)_5.5rem]" style={{ ['--label' as string]: `minmax(0, ${labelWidth})` }}>
          <span className="min-w-0 truncate text-foreground" title={row.note ? `${row.label}: ${row.note}` : row.label}>
            {row.label}
          </span>
          <span className="tabular-nums text-right text-muted-foreground sm:order-last">
            <span className="font-semibold text-foreground">{row.count}</span> · {pct(row.count, total)}%
          </span>
          <span className={`h-4 overflow-hidden rounded-r-[4px] max-sm:col-span-2 ${TRACK}`} title={`${row.label}: ${row.count} (${pct(row.count, total)}%)`}>
            <span className={`block h-full rounded-r-[4px] ${BAR}`} style={{ width: `${total ? Math.min(100, (row.count / total) * 100) : 0}%`, minWidth: row.count ? 4 : 0 }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A column chart for ordered scales (NPS 0–10, ratings), each column with its count above and its value below. */
export function Distribution({
  counts,
  start,
  colorFor,
  labels,
}: {
  counts: number[]
  start: number
  /** Optional per-value class, e.g. NPS bands. */
  colorFor?: (value: number) => string
  /** Words under the two ends, e.g. "Not likely" and "Very likely". */
  labels?: [string | undefined, string | undefined]
}) {
  const max = Math.max(1, ...counts)
  const total = counts.reduce((a, b) => a + b, 0)
  return (
    <div>
      <div className="flex h-36 items-end gap-[2px]">
        {counts.map((count, i) => {
          const value = start + i
          return (
            <div key={value} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${value}: ${count} (${pct(count, total)}%)`}>
              <span className="text-xs tabular-nums text-muted-foreground">{count || ''}</span>
              <div className={`w-full max-w-9 rounded-t-[4px] ${colorFor?.(value) ?? BAR}`} style={{ height: `${(count / max) * 100}%`, minHeight: count ? 4 : 0 }} />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-[2px] border-t border-border pt-1.5">
        {counts.map((_, i) => (
          <span key={i} className="min-w-0 flex-1 text-center text-xs tabular-nums text-muted-foreground">
            {start + i}
          </span>
        ))}
      </div>
      {labels && (labels[0] || labels[1]) && (
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  )
}

export const npsBand = (value: number) => (value <= 6 ? DETRACTOR : value <= 8 ? PASSIVE : PROMOTER)

/** Detractor / passive / promoter split as one stacked bar, each group named with its share. */
export function NpsSplit({ detractors, passives, promoters }: { detractors: number; passives: number; promoters: number }) {
  const total = detractors + passives + promoters
  const parts = [
    { label: 'Detractors', range: '0–6', count: detractors, cls: DETRACTOR },
    { label: 'Passives', range: '7–8', count: passives, cls: PASSIVE },
    { label: 'Promoters', range: '9–10', count: promoters, cls: PROMOTER },
  ]
  return (
    <div className="flex flex-col gap-2.5">
      {/* The 2px gap is the surface showing between stacked segments. */}
      <div className="flex h-3 gap-[2px]">
        {parts.map(
          p =>
            p.count > 0 && (
              <div key={p.label} title={`${p.label} (${p.range}): ${p.count}, ${pct(p.count, total)}%`} className={`${p.cls} h-full first:rounded-l-[4px] last:rounded-r-[4px]`} style={{ width: `${(p.count / total) * 100}%` }} />
            ),
        )}
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {parts.map(p => (
          <div key={p.label} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${p.cls}`} aria-hidden />
              <span className="truncate">{p.label}</span>
            </dt>
            <dd className="mt-0.5 text-sm tabular-nums text-muted-foreground">
              <span className="text-base font-semibold text-foreground">{pct(p.count, total)}%</span> · {p.count}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] text-muted-foreground">Detractors scored 0–6, passives 7–8 and promoters 9–10.</p>
    </div>
  )
}
