import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

// What every Settings page is built from, so they all line up: one bordered
// panel per page, divided into blocks. A block names itself in a narrow left
// column and puts its controls in a right column, so every field, list row
// and button on every page shares the same two edges. The columns go by the
// panel's own width, not the window's: beside each other where the panel has
// room for both, stacked where it hasn't (a laptop with the sidebar open),
// and the controls column stops growing at a width a form still reads well at.
//
//   <SettingsPanel>
//     <SettingsBlock title="People" description="…">
//       <SettingsList>…<SettingsRow>…</SettingsRow></SettingsList>
//     </SettingsBlock>
//     <SettingsBlock title="Add someone">
//       <FieldGrid>…</FieldGrid>          (components/ui/Field.tsx)
//       <SettingsActions><Button>Add person</Button></SettingsActions>
//     </SettingsBlock>
//   </SettingsPanel>
//
// Messages about the whole page (a result, a warning) go above the panel as a
// Notice (components/ui/Notice.tsx); ones about a block go inside it.

/** The page's one bordered panel; its blocks are divided by hairlines. */
export function SettingsPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`@container rounded-md-m border border-border bg-card divide-y divide-border/70 ${className}`}>{children}</div>
}

/**
 * One block of a panel. Where the panel is wide enough its title and
 * explanation sit in the left column beside the controls; where it isn't they
 * stack. The controls column is the same width in every block.
 */
export function SettingsBlock({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="grid gap-x-10 gap-y-4 px-6 py-6 @[44rem]:grid-cols-[15rem_minmax(0,46rem)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {children !== undefined && <div className="flex min-w-0 flex-col gap-3">{children}</div>}
    </section>
  )
}

/** A block's buttons: always at the bottom-left of its controls, main action first. */
export function SettingsActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>
}

/** Rows of things a block lists: people, senders, keys, domains, proxies. */
export function SettingsList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-2 ${className}`}>{children}</div>
}

/**
 * One listed thing: an optional icon, what it is, and its actions at the
 * right-hand end. `children` go underneath (an edit form, its details).
 */
export function SettingsRow({
  icon,
  title,
  detail,
  badge,
  actions,
  children,
}: {
  icon?: ReactNode
  title: ReactNode
  /** A quieter line under (or beside) the title. */
  detail?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="rounded-md-s border border-border bg-background">
      {/* Where the row is too narrow for both, the actions move under what it is rather than squeezing it. */}
      <div className="flex min-h-[46px] flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5">
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <div className="min-w-[9rem] flex-1 basis-[9rem]">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-foreground">
            <span className="min-w-0 break-words">{title}</span>
            {badge}
          </p>
          {detail && <p className="truncate text-[13px] text-muted-foreground">{detail}</p>}
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children && <div className="border-t border-border/70 px-3 py-3">{children}</div>}
    </div>
  )
}

/** While a block's contents load, or when it has nothing to list. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-md-s border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{children}</p>
}

/** One of a few choices, as a card: side by side in a FieldGrid, the chosen one outlined. */
export function SettingsOption({
  selected,
  onSelect,
  title,
  detail,
  disabled,
}: {
  selected: boolean
  onSelect: () => void
  title: ReactNode
  detail?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-w-0 items-start gap-2.5 rounded-md-s border px-3 py-2.5 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
        selected ? 'border-accent bg-accent/5' : 'border-border bg-background hover:bg-muted'
      }`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-accent' : 'border-muted-foreground/50'}`}>
        {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {detail && <span className="text-[13px] leading-relaxed text-muted-foreground">{detail}</span>}
      </span>
    </button>
  )
}

/** A tick box with what it does beside it, and an optional line on why. */
export function SettingsCheck({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-accent focus:ring-accent"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="text-[13px] leading-relaxed text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

/** The longer explanation of a block, folded away under its controls so the block leads with what to do. */
export function SettingsMore({ summary = 'How it works', children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <details className="group text-[13px] text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md-xs font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-2 flex max-w-[65ch] flex-col gap-2 leading-relaxed">{children}</div>
    </details>
  )
}
