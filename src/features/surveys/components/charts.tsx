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

/** The answer most people gave, picked out from the rest in the app's teal. */
const LEAD = 'bg-[#0a87a0] dark:bg-[#26a6b8]'
/** Every other bar, on every chart: one neutral ink, 3:1 on the card. */
export const BAR = 'bg-[#868d99] dark:bg-[#7d8491]'
const REST = BAR
const DETRACTOR = 'bg-[#d6453d] dark:bg-[#e8615a]'
const PASSIVE = 'bg-[#a8a7a1] dark:bg-[#64635d]'
const PROMOTER = 'bg-[#0a87a0] dark:bg-[#26a6b8]'
export const TRACK = 'bg-foreground/[0.06] dark:bg-foreground/[0.1]'

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

/**
 * Horizontal bars, one per row, each its share of everyone who answered, on a
 * track that is 100% and no wider than it needs to be, with its numbers right
 * after it. The label column is the same width on every card, so bars line up
 * down the page; the most-given answer is marked in teal.
 */
export function BarList({ rows, total, lead = true }: { rows: Array<{ label: string; count: number; note?: string }>; total: number; lead?: boolean }) {
  const top = Math.max(...rows.map(r => r.count))
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, i) => {
        const isLead = lead && row.count > 0 && row.count === top
        return (
          <li key={i} className="grid items-center gap-x-3 gap-y-1 text-sm max-sm:grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,14rem)_minmax(0,34rem)_6rem]">
            <span className={`min-w-0 truncate ${isLead ? 'font-medium text-foreground' : 'text-foreground'}`} title={row.note ? `${row.label}: ${row.note}` : row.label}>
              {row.label}
            </span>
            <span className="tabular-nums text-muted-foreground max-sm:text-right sm:order-last">
              <span className="font-semibold text-foreground">{pct(row.count, total)}%</span> · {row.count}
            </span>
            <span className={`h-4 overflow-hidden rounded-r-[4px] max-sm:col-span-2 ${TRACK}`} title={`${row.label}: ${row.count} (${pct(row.count, total)}%)`}>
              <span className={`block h-full rounded-r-[4px] ${isLead ? LEAD : REST}`} style={{ width: `${total ? Math.min(100, (row.count / total) * 100) : 0}%`, minWidth: row.count ? 4 : 0 }} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** A column chart for ordered scales (NPS 0–10, ratings), each column with its count above and its value below. */
export function Distribution({
  counts,
  start,
  colorFor,
  labels,
  average,
  leadMost = false,
}: {
  /** Mark the most-given value in teal (a scale's mode); NPS colours by group instead. */
  leadMost?: boolean
  counts: number[]
  start: number
  /** Optional per-value class, e.g. NPS bands. */
  colorFor?: (value: number) => string
  /** Words under the two ends, e.g. "Not likely" and "Very likely". */
  labels?: [string | undefined, string | undefined]
  /** Marks the average on the scale, between the columns it falls between. */
  average?: number | null
}) {
  const max = Math.max(1, ...counts)
  const total = counts.reduce((a, b) => a + b, 0)
  const avgAt = average === null || average === undefined ? null : ((average - start + 0.5) / counts.length) * 100
  return (
    <div>
      {avgAt !== null && (
        // The average's label sits in its own row above the plot, clear of the counts on the columns.
        <div className="relative mb-1 h-5" aria-hidden>
          <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-card px-2 text-xs font-medium leading-[18px] text-foreground" style={{ left: `${avgAt}%` }}>
            Average {average!.toFixed(1)}
          </span>
        </div>
      )}
      <div className="relative flex h-36 items-end gap-[2px]">
        {avgAt !== null && <span aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-[1] border-l-2 border-dashed border-foreground/60" style={{ left: `${avgAt}%` }} />}
        {counts.map((count, i) => {
          const value = start + i
          const top = leadMost && count > 0 && count === max
          return (
            <div key={value} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${value}: ${count} (${pct(count, total)}%)`}>
              <span className="text-xs tabular-nums text-muted-foreground">{count || ''}</span>
              <div className={`relative w-[62%] rounded-t-[4px] ${colorFor?.(value) ?? (top ? LEAD : BAR)}`} style={{ height: `calc((100% - 20px) * ${count / max})`, minHeight: count ? 8 : 0 }} />
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

/**
 * An NPS result as a band of four aligned tiles (the score, then each group's
 * share and count) over the groups as one stacked bar.
 */
export function NpsSummary({ score, detractors, passives, promoters }: { score: number | null; detractors: number; passives: number; promoters: number }) {
  const total = detractors + passives + promoters
  const parts = [
    { label: 'Detractors', range: '0–6', count: detractors, cls: DETRACTOR },
    { label: 'Passives', range: '7–8', count: passives, cls: PASSIVE },
    { label: 'Promoters', range: '9–10', count: promoters, cls: PROMOTER },
  ]
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 divide-border/70 overflow-hidden rounded-md-s border border-border max-sm:[&>div:nth-child(-n+2)]:border-b max-sm:[&>div:nth-child(odd)]:border-r sm:grid-cols-4 sm:divide-x">
        <div className="px-4 py-3">
          <dt className="text-[13px] text-muted-foreground">NPS</dt>
          <dd className="text-3xl font-semibold leading-tight tabular-nums tracking-tight text-foreground">{score === null ? '—' : `${score > 0 ? '+' : ''}${score}`}</dd>
          <dd className="text-[13px] text-muted-foreground">from −100 to +100</dd>
        </div>
        {parts.map(p => (
          <div key={p.label} className="px-4 py-3">
            <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${p.cls}`} aria-hidden />
              {p.label}
            </dt>
            <dd className="text-3xl font-semibold leading-tight tabular-nums tracking-tight text-foreground">{pct(p.count, total)}%</dd>
            <dd className="text-[13px] text-muted-foreground">
              {p.count} scored {p.range}
            </dd>
          </div>
        ))}
      </dl>
      {/* The 2px gap is the surface showing between stacked segments. */}
      <div className="flex h-3 gap-[2px]" aria-hidden>
        {parts.map(
          p =>
            p.count > 0 && (
              <div key={p.label} title={`${p.label} (${p.range}): ${p.count}, ${pct(p.count, total)}%`} className={`${p.cls} h-full first:rounded-l-[4px] last:rounded-r-[4px]`} style={{ width: `${(p.count / total) * 100}%` }} />
            ),
        )}
      </div>
    </div>
  )
}

/** NPS week by week: a column per week, up from zero for a positive score and down for a negative one, each labelled. */
export function NpsTrend({ weeks }: { weeks: Array<{ week: string; score: number; answered: number }> }) {
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const anyNegative = weeks.some(w => w.score < 0)
  return (
    <div>
      <div className={`relative flex items-stretch gap-1 ${anyNegative ? 'h-40' : 'h-28'}`}>
        <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: anyNegative ? '50%' : '100%' }} />
        {weeks.map(w => {
          const h = (Math.abs(w.score) / 100) * (anyNegative ? 50 : 100)
          return (
            <div key={w.week} className="relative min-w-0 flex-1" title={`Week of ${fmt.format(new Date(w.week))}: NPS ${w.score > 0 ? '+' : ''}${w.score}, from ${w.answered} answer${w.answered === 1 ? '' : 's'}`}>
              <div
                className={`absolute inset-x-[15%] ${w.score >= 0 ? `rounded-t-[4px] ${PROMOTER}` : `rounded-b-[4px] ${DETRACTOR}`}`}
                style={w.score >= 0 ? { bottom: anyNegative ? '50%' : 0, height: `${Math.max(h, 1)}%` } : { top: '50%', height: `${Math.max(h, 1)}%` }}
              />
              <span
                className="absolute inset-x-0 text-center text-xs font-medium tabular-nums text-foreground"
                style={w.score >= 0 ? { bottom: `calc(${anyNegative ? 50 : 0}% + ${h}% + 2px)` } : { top: `calc(50% + ${h}% + 2px)` }}
              >
                {w.score > 0 ? '+' : ''}
                {w.score}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {weeks.map(w => (
          <span key={w.week} className="min-w-0 flex-1 truncate text-center text-xs tabular-nums text-muted-foreground">
            {fmt.format(new Date(w.week))}
          </span>
        ))}
      </div>
    </div>
  )
}
