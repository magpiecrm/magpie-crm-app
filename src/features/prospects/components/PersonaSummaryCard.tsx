import type { ReactNode } from 'react'
import { Briefcase, Check, ChevronDown, Factory, Globe, Search, UserCheck, Users2 } from 'lucide-react'
import { SENIORITY_LABEL } from '../../../server/prospecting/types'
import type { PersonaFormValues } from './PersonaForm'
import { formatBand } from './PeopleFilterFields'
import type { PersonaCriteria } from '../types'

interface PersonaSummaryCardProps {
  persona: PersonaFormValues
  /** Folded into one line until opened: on a phone, where it sits above the form. */
  compact?: boolean
}

/** The id of a field's place in the persona form, so the summary can take you to it. */
export const fieldAnchor = (field: string) => `persona-field-${field}`

// The filters as the form and search's sidebar name them, in the same order.
const ROWS: Array<{ key: keyof PersonaCriteria; label: string; icon: ReactNode; values: (c: PersonaCriteria) => string[] }> = [
  { key: 'titles', label: 'Job titles', icon: <Briefcase />, values: (c) => c.titles },
  { key: 'seniorities', label: 'Seniority', icon: <UserCheck />, values: (c) => c.seniorities.map((s) => SENIORITY_LABEL[s]) },
  { key: 'industries', label: 'Industry', icon: <Factory />, values: (c) => c.industries },
  { key: 'companySizes', label: 'Company size', icon: <Users2 />, values: (c) => c.companySizes.map((b) => `${formatBand(b)} employees`) },
  { key: 'country', label: 'Country', icon: <Globe />, values: (c) => (c.country ? [c.country] : []) },
  { key: 'keyword', label: 'Keyword', icon: <Search />, values: (c) => (c.keyword.trim() ? [c.keyword.trim()] : []) },
]

/** The first few values, then "+N". */
function shortList(items: string[], max = 3) {
  const more = items.length - max
  return more > 0 ? `${items.slice(0, max).join(', ')} +${more}` : items.join(', ')
}

/** Scrolls the form to a field and puts the cursor in it. */
function goTo(field: string) {
  const el = document.getElementById(fieldAnchor(field))
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el?.querySelector<HTMLElement>('input, textarea, button')?.focus({ preventScroll: true })
}

// The persona read back as it's filled in, in the form's order, each row a
// way back to its field.
export function PersonaSummaryCard({ persona, compact = false }: PersonaSummaryCardProps) {
  const c = persona.criteria
  const anything = ROWS.some((r) => r.values(c).length > 0)
  const brief = !!persona.painPoints.trim() && !!persona.valueProp.trim()

  const body = (
    <div className="flex flex-col gap-4 px-5 pb-5" aria-live="polite">
      {anything ? (
        <dl className="flex flex-col gap-2.5">
          {ROWS.map((r) => {
            const all = r.values(c)
            return (
              <div key={r.key} className="min-w-0">
                <dt>
                  <button
                    type="button"
                    onClick={() => goTo(r.key)}
                    className="inline-flex items-center gap-2 rounded-md-xs text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer"
                  >
                    <span aria-hidden className="[&>svg]:h-4 [&>svg]:w-4">{r.icon}</span>
                    {r.label}
                  </button>
                </dt>
                <dd className={`line-clamp-2 pl-6 text-[13px] ${all.length ? 'text-foreground' : 'text-muted-foreground'}`} title={all.join(', ') || undefined}>
                  {all.length ? shortList(all) : 'Any'}
                </dd>
              </div>
            )
          })}
        </dl>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">No filters yet, so a search with it would find anyone. What you fill in shows here.</p>
      )}
      <p className="flex items-start gap-2 border-t border-border pt-4 text-[13px] text-muted-foreground">
        {brief ? (
          <>
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Pain points and value proposition written.
          </>
        ) : (
          <button type="button" onClick={() => goTo('painPoints')} className="text-left hover:text-foreground cursor-pointer">
            Add pain points and a value proposition, so the AI knows what to say.
          </button>
        )}
      </p>
    </div>
  )

  if (compact) {
    const line = [shortList(c.titles, 1), c.country, c.companySizes.map(formatBand).join(', ')].filter(Boolean).join(' · ')
    return (
      <details className="group rounded-md-m border border-border bg-card shadow-xs">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-md-m px-5 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold text-foreground">Summary</span>
            <span className="truncate text-[13px] text-muted-foreground">{line || 'No filters yet'}</span>
          </span>
          <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        {body}
      </details>
    )
  }

  return (
    <section className="rounded-md-m border border-border bg-card shadow-xs">
      <h2 className="px-5 pt-5 pb-4 text-[15px] font-semibold text-foreground">Summary</h2>
      {body}
    </section>
  )
}
