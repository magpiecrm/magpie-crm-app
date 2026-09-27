import type { ReactNode } from 'react'

/**
 * One block of a settings page. On wide screens its title and explanation sit
 * in a narrow column beside the controls, so a page uses the width it has
 * rather than stacking everything; on narrower screens they stack. `stacked`
 * keeps the title above for blocks whose content needs the full width (wide
 * tables, multi-column rows).
 */
export function SettingsBlock({
  title,
  description,
  children,
  stacked = false,
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  stacked?: boolean
}) {
  return (
    <section
      className={`grid gap-3 pb-6 border-b border-border/60 last:border-b-0 last:pb-0 ${
        stacked ? '' : 'xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-8'
      }`}
    >
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <div className="flex flex-col gap-2 text-xs text-muted-foreground leading-relaxed">{description}</div>
        )}
      </div>
      {children !== undefined && <div className="min-w-0 flex flex-col gap-3">{children}</div>}
    </section>
  )
}
