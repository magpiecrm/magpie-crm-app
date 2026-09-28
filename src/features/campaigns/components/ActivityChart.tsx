import type { ActivityBucket } from '../results'

const OPEN = 'bg-accent'
const CLICK = 'bg-[#e0892b] dark:bg-[#f0a04b]'

const SERIES = {
  opens: { color: OPEN, label: 'First opens', one: 'first open', many: 'first opens' },
  clicks: { color: CLICK, label: 'First clicks', one: 'first click', many: 'first clicks' },
} as const

/**
 * First opens and/or first clicks per hour (or day) since the send, as
 * columns on one scale. Every column has a hover label with its numbers.
 */
export function ActivityChart({
  buckets,
  hourly,
  series = ['opens', 'clicks'],
}: {
  buckets: ActivityBucket[]
  hourly: boolean
  series?: Array<keyof typeof SERIES>
}) {
  const max = Math.max(1, ...buckets.flatMap((b) => series.map((k) => b[k])))
  const ticks = [max, Math.round(max / 2), 0].filter((v, i, all) => all.indexOf(v) === i)
  // Label about eight columns, so the axis stays readable at any length.
  const every = Math.max(1, Math.ceil(buckets.length / 8))
  const when = (b: ActivityBucket) =>
    new Date(b.start).toLocaleString(undefined, hourly ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' })

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
        {series.map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${SERIES[k].color}`} />{SERIES[k].label}</span>
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <div className="relative h-40 w-6 text-[10px] text-muted-foreground tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / max) * 100}%` }}>{t}</span>
          ))}
        </div>
        <div className="relative h-40 border-b border-border">
          {ticks.filter((t) => t > 0).map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ top: `${(1 - t / max) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-px">
            {buckets.map((b) => (
              <div
                key={b.start}
                className="flex-1 h-full flex items-end justify-center gap-px group hover:bg-muted/40 rounded-t"
                title={`${when(b)}: ${series.map((k) => `${b[k]} ${b[k] === 1 ? SERIES[k].one : SERIES[k].many}`).join(', ')}`}
              >
                {series.map((k) => (
                  <div
                    key={k}
                    className={`${series.length > 1 ? 'w-1/2 max-w-3' : 'w-3/4 max-w-5'} rounded-t-sm ${SERIES[k].color}`}
                    style={{ height: `${(b[k] / max) * 100}%`, minHeight: b[k] ? 2 : 0 }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div />
        <div className="flex gap-px text-[10px] text-muted-foreground tabular-nums mt-1.5">
          {buckets.map((b, i) => (
            <span key={b.start} className="flex-1 text-center overflow-visible whitespace-nowrap">
              {i % every === 0 ? b.label : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
