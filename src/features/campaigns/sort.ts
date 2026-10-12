import { campaignTotals } from './results'

/** The orders a list of campaigns can be put in (CampaignSort). Newest first unless one is chosen. */
export const CAMPAIGN_SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'openRate', label: 'Open rate' },
  { id: 'clickRate', label: 'Click rate (CTR)' },
  { id: 'recipients', label: 'Most recipients' },
  { id: 'unsubRate', label: 'Unsubscribe rate' },
  { id: 'bounceRate', label: 'Bounce rate' },
  { id: 'name', label: 'Name (A to Z)' },
] as const

export type CampaignSortId = (typeof CAMPAIGN_SORTS)[number]['id']
export const DEFAULT_CAMPAIGN_SORT: CampaignSortId = 'newest'
export const isCampaignSort = (v: unknown): v is CampaignSortId => CAMPAIGN_SORTS.some((s) => s.id === v)

interface Sortable {
  id: number
  name?: string
  createdAt?: string | null
  sentAt?: string | null
  statistics?: { globalStats?: Record<string, number | undefined> }
}

/** When a campaign last happened: when it was sent, or for one that hasn't been, when it was made. */
const happened = (c: Sortable) => Date.parse(c.sentAt || c.createdAt || '') || 0

/** A campaign's rates as shares of what was delivered (bounces, of what was sent); null where nothing has gone out to divide by. */
function rates(c: Sortable) {
  const t = campaignTotals(c.statistics?.globalStats)
  const bounces = t.softBounces + t.hardBounces
  const delivered = t.delivered || Math.max(0, t.sent - bounces)
  const of = (n: number, whole: number) => (whole > 0 ? n / whole : null)
  return { recipients: t.sent, openRate: of(t.opened, delivered), clickRate: of(t.clicked, delivered), unsubRate: of(t.unsubscribed, delivered), bounceRate: of(bounces, t.sent) }
}

/**
 * Campaigns in the chosen order, as a new list. Rates run highest first, and
 * campaigns with nothing sent yet go last, since they have no rate. Ties, and
 * everything else, fall back to newest first.
 */
export function sortCampaigns<T extends Sortable>(campaigns: T[], sort: CampaignSortId): T[] {
  const newest = (a: T, b: T) => happened(b) - happened(a) || b.id - a.id
  if (sort === 'newest') return [...campaigns].sort(newest)
  if (sort === 'oldest') return [...campaigns].sort((a, b) => newest(b, a))
  if (sort === 'name') return [...campaigns].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base', numeric: true }) || newest(a, b))
  const scored = campaigns.map((c) => ({ c, score: rates(c)[sort] }))
  return scored
    .sort((a, b) => {
      if (a.score === null || b.score === null) return a.score === b.score ? newest(a.c, b.c) : a.score === null ? 1 : -1
      return b.score - a.score || newest(a.c, b.c)
    })
    .map((s) => s.c)
}
