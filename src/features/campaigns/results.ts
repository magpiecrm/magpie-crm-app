import type { getCampaignActivityFn } from '../../server/functions'
import type { ExportColumn } from '../../utils/export'

export type CampaignActivity = Awaited<ReturnType<typeof getCampaignActivityFn>>
export type RecipientActivity = CampaignActivity['recipients'][number]
export type LinkActivity = CampaignActivity['links'][number]

/** The campaign's totals, as `getCampaignStats` reports them. */
export interface CampaignTotals {
  sent: number
  delivered: number
  opened: number
  clicked: number
  totalOpens: number
  totalClicks: number
  /** Clicks from security scanners, left out of the click figures. */
  automatedClicks: number
  softBounces: number
  hardBounces: number
  unsubscribed: number
  complaints: number
}

export function campaignTotals(globalStats: Record<string, number | undefined> = {}): CampaignTotals {
  const n = (v: number | undefined) => v ?? 0
  return {
    sent: n(globalStats.sent),
    delivered: n(globalStats.delivered),
    opened: n(globalStats.uniqueOpens ?? globalStats.uniqueViews),
    clicked: n(globalStats.uniqueClicks ?? globalStats.clickers),
    totalOpens: n(globalStats.totalOpens ?? globalStats.uniqueOpens),
    totalClicks: n(globalStats.totalClicks ?? globalStats.uniqueClicks),
    automatedClicks: n(globalStats.automatedClicks),
    softBounces: n(globalStats.softBounces),
    hardBounces: n(globalStats.hardBounces),
    unsubscribed: n(globalStats.unsubscribed ?? globalStats.unsubscriptions),
    complaints: n(globalStats.complaints),
  }
}

/** A share as a percentage with one decimal, or a dash when there's nothing to divide by. */
export const percent = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '–')

export const RECIPIENT_FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'opened', label: 'Opened', test: (r: RecipientActivity) => Boolean(r.openedAt || r.clickedAt) },
  { id: 'clicked', label: 'Clicked', test: (r: RecipientActivity) => Boolean(r.clickedAt) },
  { id: 'unopened', label: "Didn't open", test: (r: RecipientActivity) => !r.openedAt && !r.clickedAt && r.outcome !== 'bounced' },
  { id: 'bounced', label: 'Bounced', test: (r: RecipientActivity) => r.outcome === 'bounced' },
  { id: 'unsubscribed', label: 'Unsubscribed', test: (r: RecipientActivity) => r.outcome === 'unsubscribed' || r.outcome === 'complained' },
] as const

export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number]['id']

export const OUTCOME_LABEL: Record<RecipientActivity['outcome'], string> = {
  clicked: 'Clicked',
  opened: 'Opened',
  sent: "Didn't open",
  bounced: 'Bounced',
  unsubscribed: 'Unsubscribed',
  complained: 'Marked as spam',
}

export const OUTCOME_BADGE: Record<RecipientActivity['outcome'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  clicked: 'info',
  opened: 'success',
  sent: 'default',
  bounced: 'error',
  unsubscribed: 'warning',
  complained: 'error',
}

/** A link as people would recognise it: host and path, no tracking noise. */
export function linkLabel(url: string): string {
  if (/^\/s\/[^/]+$/.test(url)) return 'Survey'
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}

export const shortTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–'

/** Latest thing the recipient did, for sorting and the "Last activity" column. */
export const lastActivity = (r: RecipientActivity) =>
  [r.lastOpenedAt, r.clickedAt, r.unsubscribedAt, r.bouncedAt].filter((t): t is string => Boolean(t)).sort().at(-1) ?? null

export interface ActivityBucket {
  label: string
  start: number
  opens: number
  clicks: number
}

/**
 * First opens and first clicks over time since the send: hourly across the
 * first two days, daily after that (up to 30 days).
 */
export function activityOverTime(recipients: RecipientActivity[], sentAt: string, now = Date.now()): { buckets: ActivityBucket[]; hourly: boolean } {
  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  const start = new Date(sentAt).getTime()
  const events = recipients.flatMap((r) => [
    ...(r.openedAt ? [{ at: new Date(r.openedAt).getTime(), kind: 'opens' as const }] : []),
    ...(r.clickedAt ? [{ at: new Date(r.clickedAt).getTime(), kind: 'clicks' as const }] : []),
  ])
  const lastAt = Math.max(now, ...events.map((e) => e.at))
  const hourly = lastAt - start <= 2 * DAY
  const size = hourly ? HOUR : DAY
  const count = Math.max(1, Math.min(hourly ? 48 : 30, Math.ceil((lastAt - start) / size)))

  const buckets: ActivityBucket[] = Array.from({ length: count }, (_, i) => ({
    label: hourly ? `${i}h` : `Day ${i + 1}`,
    start: start + i * size,
    opens: 0,
    clicks: 0,
  }))
  for (const e of events) {
    const i = Math.floor((e.at - start) / size)
    if (i >= 0 && i < count) buckets[i][e.kind] += 1
  }
  return { buckets, hourly }
}

export const RECIPIENT_EXPORT_COLUMNS: ExportColumn<RecipientActivity>[] = [
  { header: 'Email', value: (r) => r.email },
  { header: 'Name', value: (r) => r.name },
  { header: 'Company', value: (r) => r.company },
  { header: 'Status', value: (r) => OUTCOME_LABEL[r.outcome] + (r.bounce ? ` (${r.bounce})` : '') },
  { header: 'Sent at', value: (r) => r.sentAt },
  { header: 'First opened', value: (r) => r.openedAt },
  { header: 'Opens', value: (r) => r.opens },
  { header: 'First clicked', value: (r) => r.clickedAt },
  { header: 'Clicks', value: (r) => r.clicks },
  { header: 'Links clicked', value: (r) => r.links.map((l) => `${l.url} (${l.clicks})`).join('; ') },
  { header: 'Unsubscribed at', value: (r) => r.unsubscribedAt },
  { header: 'Bounced at', value: (r) => r.bouncedAt },
]
