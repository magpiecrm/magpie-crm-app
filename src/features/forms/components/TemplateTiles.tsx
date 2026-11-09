import { Link } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { FORM_TEMPLATES } from '../templates'

/** Where a new form can start: the empty Forms page and New form both show these. */
export function TemplateTiles() {
  const tile =
    'group flex items-start gap-3 rounded-md-m border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FORM_TEMPLATES.map((t) => (
        <Link key={t.id} to="/marketing/forms/new" search={{ template: t.id }} className={tile}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md-s border border-border bg-background text-foreground/75">
            <t.icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-foreground">{t.name}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">{t.description}</span>
          </span>
          <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ))}
      <Link to="/marketing/forms/new" search={{ template: 'blank' }} className={`${tile} border-dashed bg-transparent sm:col-span-2`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md-s border border-dashed border-border text-foreground/75">
          <Plus className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-foreground">Blank form</span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">Just an email field. Add the rest yourself.</span>
        </span>
        <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </div>
  )
}
