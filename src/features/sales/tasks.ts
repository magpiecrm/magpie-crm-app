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

/**
 * A due (or done) time as the Tasks page's column shows it, under a heading
 * that already says whether it's overdue: "Today 14:00", "Tomorrow 09:00",
 * "Yesterday 16:12", else the day ("Fri 6 Nov", with the year when it isn't
 * this one).
 */
export function dueShort(at: string, now = new Date()): string {
  const { day, time, relative } = dueParts(at, now)
  return relative ? `${day} ${time}` : day
}

/** The day ("Today", "Tomorrow", "Yesterday", else "Fri 6 Nov") and the time ("09:00") apart, for a column that lines the times up. */
export function dueParts(at: string, now = new Date()): { day: string; time: string; relative: boolean } {
  const due = new Date(at)
  const time = due.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const offset = (n: number) => {
    const d = new Date(now)
    d.setDate(now.getDate() + n)
    return dayKey(d)
  }
  const near = dayKey(due) === dayKey(now) ? 'Today' : dayKey(due) === offset(1) ? 'Tomorrow' : dayKey(due) === offset(-1) ? 'Yesterday' : null
  if (near) return { day: near, time, relative: true }
  // Put together, as en-GB puts a comma after the weekday once there's a year.
  const weekday = due.toLocaleDateString('en-GB', { weekday: 'short' })
  const date = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(due.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
  return { day: `${weekday} ${date}`, time, relative: false }
}

/** How late an overdue task is, in one compact unit for the Overdue group's column: "25m late", "5h late", "4d late". */
export function lateBy(at: string, now = new Date()): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m late`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h late`
  return `${Math.floor(hours / 24)}d late`
}

/** A local date-and-time input's value ("2026-10-02T09:00") as an ISO time, or null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}
