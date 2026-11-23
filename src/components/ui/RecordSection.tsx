import type { ReactNode } from 'react'

/** A titled part of a record's main column: a card with a heading, an optional count and an action. */
export function Section({ title, count, action, children, id }: { title: string; count?: number; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="rounded-xl border border-border bg-card">
      <header className="flex min-h-12 items-center justify-between gap-3 px-5 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {action}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  )
}

/** A titled part of a record's side panel: no card of its own, divided from the one above by a rule. */
export function PanelSection({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="px-5 py-4 [&+&]:border-t [&+&]:border-border">
      <header className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

/** The small text button at the end of a section's heading: "New deal", "Edit". */
export const SECTION_ACTION =
  'touch-target inline-flex items-center gap-1 rounded-md-xs px-1.5 py-1 -mr-1.5 text-xs font-semibold text-accent hover:bg-accent/10 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/** One row of a details list: a muted label, its value beside it. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  )
}
