/** The waits offered between a campaign's batches (ScheduleDrawer). */
export const BATCH_WAITS = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: 'An hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 720, label: '12 hours' },
  { minutes: 1440, label: 'A day' },
] as const

/** "every hour", "every 2 hours", "every 45 minutes": how often a campaign's batches go. */
export function everyText(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'every day' : `every ${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? 'every hour' : `every ${minutes / 60} hours`
  return `every ${minutes} minutes`
}
