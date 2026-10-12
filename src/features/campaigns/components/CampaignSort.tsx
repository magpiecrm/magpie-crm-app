import { useEffect, useState } from 'react'
import { Select } from '../../../components/ui/Select'
import { CAMPAIGN_SORTS, DEFAULT_CAMPAIGN_SORT, isCampaignSort, type CampaignSortId } from '../sort'

/**
 * The order a page lists campaigns in: newest first until one is chosen,
 * then remembered in this browser for that page (`page` names it).
 */
export function useCampaignSort(page: string): [CampaignSortId, (sort: CampaignSortId) => void] {
  const key = `campaign-sort:${page}`
  const [sort, setSort] = useState<CampaignSortId>(DEFAULT_CAMPAIGN_SORT)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      if (isCampaignSort(saved)) setSort(saved)
    } catch {
      // No storage (a private window): newest first.
    }
  }, [key])
  const choose = (next: CampaignSortId) => {
    setSort(next)
    try {
      localStorage.setItem(key, next)
    } catch {
      // Not remembered, which is all that's lost.
    }
  }
  return [sort, choose]
}

/** The "Sort by" dropdown over a list of campaigns. */
export function CampaignSort({ value, onChange }: { value: CampaignSortId; onChange: (sort: CampaignSortId) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span id="campaign-sort-label" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
        Sort by
      </span>
      <Select
        value={value}
        onChange={(e) => isCampaignSort(e.target.value) && onChange(e.target.value)}
        aria-labelledby="campaign-sort-label"
        className="h-9 min-w-[11.5rem] rounded-md-s border border-border bg-card px-3 text-sm text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {CAMPAIGN_SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
