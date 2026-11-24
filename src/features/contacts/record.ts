/**
 * What a contact's page shows of their history: one item per email, form,
 * survey or note, newest first, and the dates in one format.
 */
import type { ContactActivity } from '../../server/contactActivity'

export type FeedKind = 'campaign' | 'sequence' | 'reply' | 'form' | 'survey' | 'note'
export type FeedFilter = 'all' | 'emails' | 'notes' | 'forms'

export interface FeedNote {
  id: string
  body: string
  created_by: string | null
  created_at: string
}

/** What they wrote back to a sequence (sequences.repliesForContact). */
export interface FeedReply {
  id: string
  enrollment_id: string
  sequence_id: string
  sequence_name: string
  subject: string
  at: string
  excerpt: string
  /** Someone has written back since. */
  answered: boolean
}

/** A survey they answered, with its answers ready to show. */
export interface FeedSurvey {
  id: string
  answers: Array<{ question: string; answer: string }>
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
  reply?: FeedReply
  /** A survey's answers. */
  answers?: FeedSurvey['answers']
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

/** The contact's events, replies and notes as one list, each email's send, open, click and reply as one item. */
export function buildFeed(activity: ContactActivity[], notes: FeedNote[], replies: FeedReply[] = [], surveys: FeedSurvey[] = []): FeedItem[] {
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
  for (const sv of surveys) {
    const item = byRef.get(`survey:${sv.id}`)
    if (item && sv.answers.length) item.answers = sv.answers
  }
  const items: FeedItem[] = [...byRef.values()]
  for (const n of notes) items.push({ key: `note:${n.id}`, kind: 'note', at: n.created_at, title: '', note: n })
  for (const r of replies) items.push({ key: `reply:${r.id}`, kind: 'reply', at: r.at, title: r.sequence_name, reply: r })
  return items.sort((a, b) => b.at.localeCompare(a.at))
}

export function matchesFilter(item: FeedItem, filter: FeedFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'emails') return item.kind === 'campaign' || item.kind === 'sequence' || item.kind === 'reply'
  if (filter === 'notes') return item.kind === 'note'
  return item.kind === 'form' || item.kind === 'survey'
}

const sameYear = (d: Date, now: Date) => d.getFullYear() === now.getFullYear()
// Three letters every month: the browser's own en-GB short months say "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "16 Sep", or "16 Sep 2025" in another year. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear(d, now) ? '' : ` ${d.getFullYear()}`}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "16 Sep, 12:35", or "16 Sep 2025, 12:35" in another year; in the coming week, "Wed 25 Nov, 09:00". Never seconds. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const ahead = d.getTime() - now.getTime()
  const weekday = ahead > 0 && ahead < 7 * 86_400_000 ? `${WEEKDAYS[d.getDay()]} ` : ''
  return `${weekday}${formatDay(iso, now)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
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
