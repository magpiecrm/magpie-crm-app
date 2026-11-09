/** Dates on the Forms pages, in one style: "10 Nov 2026, 08:06" exactly, "Today 08:06" or "3 days ago" in passing. */

const exactFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const dayYearFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })

export const exactTime = (iso: string) => exactFmt.format(new Date(iso))

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** For a table column: "Today 08:06", "Yesterday 10:18", "Fri 6 Nov", "22 Oct", "3 Mar 2025". */
export function whenShort(iso: string, now = new Date()) {
  const d = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400e3)
  if (days === 0) return `Today ${timeFmt.format(d)}`
  if (days === 1) return `Yesterday ${timeFmt.format(d)}`
  if (days > 1 && days < 7) return `${weekdayFmt.format(d)} ${dayFmt.format(d)}`
  return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d)
}

/** In a sentence: "just now", "2 hours ago", "yesterday", "3 days ago", "on 22 Oct". */
export function ago(iso: string, now = new Date()) {
  const ms = now.getTime() - Date.parse(iso)
  const min = Math.round(ms / 60e3)
  if (min < 2) return 'just now'
  if (min < 60) return `${min} minutes ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86400e3)
  if (days <= 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return `on ${whenShort(iso, now)}`
}

/** "5 minutes", "1 hour", "Straight away". */
export function delayLabel(minutes: number) {
  if (minutes <= 0) return 'straight away'
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
