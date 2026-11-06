import type { ReactNode } from 'react'

/**
 * A text field, select or textarea as every form draws it: one height (the
 * same as a button's, so they line up side by side), one border, one focus
 * ring. Fields fill the width they're given; a grid decides how wide that is.
 */
export const INPUT_CLASS =
  'w-full min-h-[38px] bg-card border border-input rounded-md-s px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed'

/** A control under its label, with an optional hint or error beneath. */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  as: Wrapper = 'label',
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
  /** `div` for controls that aren't one input: clicking a label's text presses the first button inside it. */
  as?: 'label' | 'div'
}) {
  return (
    <Wrapper className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      {children}
      {error ? (
        <span className="text-[13px] text-destructive">{error}</span>
      ) : (
        hint && <span className="text-[13px] text-muted-foreground leading-relaxed">{hint}</span>
      )}
    </Wrapper>
  )
}

/**
 * Fields side by side on a shared grid, two or three across (one on a phone).
 * A lone short field goes in a grid too, so it takes one slot rather than the
 * whole width and still lines up with the fields above it.
 */
export function FieldGrid({ cols = 2, children, className = '' }: { cols?: 2 | 3; children: ReactNode; className?: string }) {
  return <div className={`grid gap-3 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} ${className}`}>{children}</div>
}

/** A command, key or snippet to copy: it scrolls sideways inside its column rather than widening it. */
export const CODE_CLASS = 'rounded-md-s border border-border bg-background px-3 py-2 text-xs overflow-x-auto font-mono leading-relaxed text-foreground'
