/**
 * What a contact's page shows of their history: one item per email, form,
 * survey or note, newest first, and the dates in one format.
 */
import type { ContactActivity } from '../../server/contactActivity'

export type FeedKind = 'campaign' | 'sequence' | 'form' | 'survey' | 'note'
export type FeedFilter = 'all' | 'emails' | 'notes' | 'forms'

export interface FeedNote {
  id: string
  body: string
  created_by: string | null
  created_at: string
}

export interface FeedItem {
  key: string
  kind: FeedKind
  /** When it happened: an email's send, a form's submission, a survey's start, a note's writing. */
  at: string
  /** The email, form or survey's name; empty for a note. */
  title: string
  url?: string
  opened?: string
  clicked?: string
  replied?: string
  completed?: string
  note?: FeedNote
}

const KIND: Record<ContactActivity['type'], FeedKind> = {
  campaign_sent: 'campaign',
  campaign_opened: 'campaign',
  campaign_clicked: 'campaign',
  sequence_sent: 'sequence',
  sequence_opened: 'sequence',
  sequence_clicked: 'sequence',
  sequence_replied: 'sequence',
  form_submitted: 'form',
  survey_started: 'survey',
  survey_completed: 'survey',
}

/** The contact's events and notes as one list, each email's send, open, click and reply as one item. */
export function buildFeed(activity: ContactActivity[], notes: FeedNote[]): FeedItem[] {
  const byRef = new Map<string, FeedItem>()
  // Items dated by their send, start or submission; the rest by their earliest event.
  const dated = new Set<string>()
  for (const e of activity) {
    let item = byRef.get(e.ref)
    if (!item) {
      item = { key: e.ref, kind: KIND[e.type], at: e.at, title: e.name, url: e.url }
      byRef.set(e.ref, item)
    }
    if (e.type.endsWith('_opened')) item.opened = e.at
    else if (e.type.endsWith('_clicked')) item.clicked = e.at
    else if (e.type === 'sequence_replied') item.replied = e.at
    else if (e.type === 'survey_completed') item.completed = e.at
    if (e.type.endsWith('_sent') || e.type === 'survey_started' || e.type === 'form_submitted') {
      item.at = e.at
      dated.add(e.ref)
    } else if (!dated.has(e.ref) && e.at < item.at) item.at = e.at
  }
  const items: FeedItem[] = [...byRef.values()]
  for (const n of notes) items.push({ key: `note:${n.id}`, kind: 'note', at: n.created_at, title: '', note: n })
  return items.sort((a, b) => b.at.localeCompare(a.at))
}

export function matchesFilter(item: FeedItem, filter: FeedFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'emails') return item.kind === 'campaign' || item.kind === 'sequence'
  if (filter === 'notes') return item.kind === 'note'
  return item.kind === 'form' || item.kind === 'survey'
}

const sameYear = (d: Date, now: Date) => d.getFullYear() === now.getFullYear()

/** "16 Sep", or "16 Sep 2025" in another year. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear(d, now) ? {} : { year: 'numeric' }) })
}

/** "16 Sep, 12:35", or "16 Sep 2025, 12:35" in another year. Never seconds. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  return `${formatDay(iso, now)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/** "Just now", "20 min ago", "3 hours ago", "Yesterday", "4 days ago", then the day. */
export function formatAgo(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const mins = Math.round((now.getTime() - d.getTime()) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= startOfToday) {
    const hours = Math.round(mins / 60)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.ceil((startOfToday - d.getTime()) / 86_400_000)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return formatDay(iso, now)
}

/** The month an item falls in, as a feed's heading: "November", or "November 2025" in another year. */
export function monthOf(iso: string, now = new Date()): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { month: 'long', ...(sameYear(d, now) ? {} : { year: 'numeric' }) })
}
