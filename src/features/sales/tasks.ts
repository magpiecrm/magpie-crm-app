// When tasks are due, in the person's own time zone: quick choices for a
// follow-up, and how a due time reads ("Overdue · 2 Oct", "Today 09:00").

/** A follow-up this many days from today, at 9am local time. */
export function daysFromNow(days: number, now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

export const FOLLOW_UPS: Array<{ label: string; days: number }> = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
]

export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'none'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export function dueBucket(dueAt: string | null | undefined, now = new Date()): DueBucket {
  if (!dueAt) return 'none'
  const due = new Date(dueAt)
  if (due.getTime() < now.getTime()) return 'overdue'
  return dayKey(due) === dayKey(now) ? 'today' : 'upcoming'
}

export function dueLabel(dueAt: string | null | undefined, now = new Date()): string {
  if (!dueAt) return 'No due date'
  const due = new Date(dueAt)
  const time = due.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (dayKey(due) === dayKey(now)) return `${due.getTime() < now.getTime() ? 'Overdue · ' : ''}Today ${time}`
  if (dayKey(due) === dayKey(tomorrow)) return `Tomorrow ${time}`
  const day = due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return due.getTime() < now.getTime() ? `Overdue · ${day}` : day
}

/** A local date-and-time input's value ("2026-10-02T09:00") as an ISO time, or null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}
