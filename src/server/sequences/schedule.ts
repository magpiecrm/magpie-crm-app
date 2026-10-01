// When a sequence may send, how many a day, how far apart, and how a
// follow-up threads onto the emails before it. Pure, so the engine's rules
// can be tested with any clock.

import type { EnrollmentSend, SequenceSettings, SequenceStep } from '../../features/sequences/types'

const DAY_MS = 86_400_000
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** The local weekday, hour, minute and date of `at` in a time zone (UTC if it isn't one). */
export function zonedParts(at: Date, timeZone: string): { weekday: number; hour: number; minute: number; day: string } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  } catch {
    return zonedParts(at, 'UTC')
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    weekday: WEEKDAYS[get('weekday')] ?? 0,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    day: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Inside the sequence's sending days and hours, where it is. */
export function inSendWindow(now: Date, s: Pick<SequenceSettings, 'days' | 'start_hour' | 'end_hour' | 'time_zone'>): boolean {
  const { weekday, hour } = zonedParts(now, s.time_zone)
  return s.days.includes(weekday) && hour >= s.start_hour && hour < s.end_hour
}

/**
 * The first moment at or after `from` inside the sending window: when an
 * email due then can actually go (to show; the cap and pacing can push it
 * later). Null when the window never opens (no days chosen).
 */
export function firstSendable(from: Date, s: Pick<SequenceSettings, 'days' | 'start_hour' | 'end_hour' | 'time_zone'>): Date | null {
  if (!s.days.length || s.start_hour >= s.end_hour) return null
  if (inSendWindow(from, s)) return from
  // Forward to the next quarter hour, then by quarter hours, for at most 8 days.
  let t = new Date(Math.ceil(from.getTime() / (15 * 60_000)) * 15 * 60_000)
  for (let i = 0; i < 8 * 24 * 4; i++, t = new Date(t.getTime() + 15 * 60_000)) {
    if (inSendWindow(t, s)) return t
  }
  return null
}

/** Minutes left in today's sending window (0 outside it). */
export function minutesLeft(now: Date, s: Pick<SequenceSettings, 'days' | 'start_hour' | 'end_hour' | 'time_zone'>): number {
  if (!inSendWindow(now, s)) return 0
  const { hour, minute } = zonedParts(now, s.time_zone)
  return s.end_hour * 60 - (hour * 60 + minute)
}

/** How many of these sends were on the same local day as `now`. */
export function sentToday(sendTimes: string[], now: Date, timeZone: string): number {
  const today = zonedParts(now, timeZone).day
  return sendTimes.filter((at) => zonedParts(new Date(at), timeZone).day === today).length
}

/**
 * The wait before the next email: today's remaining window shared out over
 * the emails left today, varied a little so they don't go out like clockwork,
 * and kept between a minute and twenty.
 */
export function nextGapMs(minutesLeftToday: number, leftToday: number, random = Math.random): number {
  const even = leftToday > 0 ? (minutesLeftToday * 60_000) / leftToday : 20 * 60_000
  const varied = even * (0.7 + random() * 0.6)
  return Math.round(Math.min(20 * 60_000, Math.max(60_000, varied)))
}

/** When a step is due: `delay_days` after the previous send (or after enrolling, for the first). */
export function dueAfter(from: string, delayDays: number): string {
  return new Date(Date.parse(from) + Math.max(0, delayDays) * DAY_MS).toISOString()
}

const stripRe = (subject: string) => subject.replace(/^(\s*re\s*:\s*)+/i, '').trim()

/**
 * A step's subject and threading. A step with its own subject starts a new
 * conversation; one without replies to the last email: "Re: <its subject>",
 * In-Reply-To that email, References the thread's emails since it started
 * (the last ten).
 */
export function threadFor(step: Pick<SequenceStep, 'subject'>, sends: Pick<EnrollmentSend, 'message_id' | 'subject' | 'step_id'>[], steps: Pick<SequenceStep, 'id' | 'subject'>[]): {
  subject: string
  inReplyTo?: string
  references?: string[]
} {
  const last = sends.at(-1)
  if (step.subject?.trim() || !last) return { subject: step.subject?.trim() ?? '' }
  // The thread: back to the last email whose step had its own subject.
  const thread: typeof sends = []
  for (let i = sends.length - 1; i >= 0; i--) {
    thread.unshift(sends[i])
    if (steps.find((s) => s.id === sends[i].step_id)?.subject?.trim()) break
  }
  return {
    subject: `Re: ${stripRe(thread[0].subject)}`,
    inReplyTo: last.message_id,
    references: thread.map((t) => t.message_id).slice(-10),
  }
}

/**
 * Where each enrollment carries on after the steps change: a step that's
 * still there keeps its place; a deleted one moves on to the next that's left.
 */
export function remapStep(nextStep: number, oldSteps: Pick<SequenceStep, 'id'>[], newSteps: Pick<SequenceStep, 'id'>[]): number {
  for (let i = nextStep; i < oldSteps.length; i++) {
    const at = newSteps.findIndex((s) => s.id === oldSteps[i].id)
    if (at >= 0) return at
  }
  return newSteps.length
}
