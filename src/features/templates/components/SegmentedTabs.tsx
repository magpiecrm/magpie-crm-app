/** A tab of a segmented control: one row of pill buttons, the current one raised. */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  className = '',
  scroll,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: React.ReactNode }>
  label: string
  className?: string
  /** On a phone, one row that scrolls sideways rather than wrapping. */
  scroll?: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      // Scrolling on a phone, its right end fades, so the kinds past the edge are seen to be there.
      className={`inline-flex max-w-full gap-1 rounded-md-s bg-muted p-1 ${scroll ? 'max-sm:overflow-x-auto max-sm:pr-8 max-sm:[scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)] sm:flex-wrap' : 'flex-wrap'} ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 cursor-pointer whitespace-nowrap rounded-md-xs px-3 py-2 max-sm:min-h-10 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            value === o.value ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.08)] dark:bg-white/10' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
