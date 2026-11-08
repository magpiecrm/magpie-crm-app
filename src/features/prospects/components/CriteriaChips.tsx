import { Badge } from '../../../components/ui/Badge'
import { SENIORITY_LABEL } from '../../../server/prospecting/types'
import type { PersonaCriteria } from '../types'

/** People search filters as chips: what applying them would search for (persona drafts, a suggested search). */
export function CriteriaChips({ criteria: c }: { criteria: PersonaCriteria }) {
  const chips = [
    ...c.titles.map((t) => ({ text: t, variant: 'default' as const })),
    ...c.seniorities.map((s) => ({ text: SENIORITY_LABEL[s], variant: 'default' as const })),
    ...c.industries.map((i) => ({ text: i, variant: 'info' as const })),
    ...c.companySizes.map((b) => ({ text: `${b} staff`, variant: 'info' as const })),
    ...(c.country ? [{ text: c.country, variant: 'info' as const }] : []),
    ...(c.keyword ? [{ text: `"${c.keyword}"`, variant: 'info' as const }] : []),
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <Badge key={i} variant={chip.variant}>
          {chip.text}
        </Badge>
      ))}
    </div>
  )
}
