import { Target, AlertTriangle, Gift } from 'lucide-react'
import type { PersonaFormValues } from './PersonaForm'

interface PersonaSummaryCardProps {
  persona: PersonaFormValues
}

// Compact preview of what this persona means for Prospect Search + messaging.
export function PersonaSummaryCard({ persona }: PersonaSummaryCardProps) {
  const c = persona.criteria
  const groups: Array<{ label: string; count: number }> = [
    { label: 'titles', count: c.title.length },
    { label: 'seniorities', count: c.seniority.length },
    { label: 'industries', count: c.industry.length },
    { label: 'locations', count: c.location.length },
    { label: 'keywords', count: c.keywords.length },
    { label: 'exclusions', count: c.excludedTitles.length },
    { label: 'size range', count: c.employeeCount.trim() ? 1 : 0 },
  ].filter(g => g.count > 0)

  const summary = groups.length > 0
    ? groups.map(g => `${g.count} ${g.label}`).join(' · ')
    : 'No targeting criteria yet'

  return (
    <div className="card border border-border rounded-md-m p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {persona.name.trim() || 'Untitled Persona'}
          </h3>
          {persona.description.trim() && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{persona.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Target className="w-3.5 h-3.5 shrink-0 text-accent" />
        <span className="truncate">{summary}</span>
      </div>

      {persona.painPoints.trim() && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
          <span className="line-clamp-2">{persona.painPoints}</span>
        </div>
      )}

      {persona.valueProp.trim() && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Gift className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
          <span className="line-clamp-2">{persona.valueProp}</span>
        </div>
      )}
    </div>
  )
}
