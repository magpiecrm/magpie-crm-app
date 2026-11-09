import { Link } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { FORM_TEMPLATES } from '../templates'

/** A small drawing of a form: a bar per field (wider for a message) and the button. */
function Sketch({ fields }: { fields: string[] }) {
  return (
    <span aria-hidden className="flex h-[58px] w-[52px] shrink-0 flex-col gap-[3px] rounded-md-s border border-border bg-background p-1.5">
      {fields.slice(0, 5).map((f, i) => (
        <span key={i} className={`block rounded-[2px] bg-foreground/[0.12] ${f === 'message' ? 'h-[9px]' : f === 'consent' ? 'h-[3px] w-2/3' : 'h-[5px]'}`} />
      ))}
      <span className="mt-auto block h-[6px] w-5 rounded-[2px] bg-foreground/45" />
    </span>
  )
}

/** Where a new form can start: the empty Forms page and New form both show these. */
export function TemplateTiles() {
  const tile =
    'group flex items-start gap-3 rounded-md-m border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {FORM_TEMPLATES.map((t) => (
        <Link key={t.id} to="/marketing/forms/new" search={{ template: t.id }} className={tile}>
          <Sketch fields={t.draft.fields ?? []} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-foreground">{t.name}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">{t.description}</span>
          </span>
          <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ))}
      {/* Blank: just the email. */}
      <Link to="/marketing/forms/new" search={{ template: 'blank' }} className={tile}>
        <span aria-hidden className="flex h-[58px] w-[52px] shrink-0 items-center justify-center rounded-md-s border border-dashed border-border text-foreground/60">
          <Plus className="h-5 w-5" />
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
