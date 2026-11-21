/**
 * The dates Analytics is narrowed to, as the date inputs give them
 * (`YYYY-MM-DD`, or '' for no limit on that side). Both empty, the default,
 * shows every campaign, whenever it was sent.
 */
export interface DateRange {
  start: string
  end: string
}

export const ALL_TIME: DateRange = { start: '', end: '' }

/**
 * Whether a campaign falls in the range, by when it was sent (or made, if
 * it hasn't been). Days are whole days where the person is: from the start of
 * `start` to the end of `end`. One with no date at all is always shown.
 */
export function inDateRange(c: { sentDate?: string | null; createdAt?: string | null }, range: DateRange): boolean {
  const when = c.sentDate || c.createdAt
  if (!when) return true
  const at = new Date(when).getTime()
  if (Number.isNaN(at)) return true
  if (range.start && at < new Date(`${range.start}T00:00:00`).getTime()) return false
  if (range.end && at > new Date(`${range.end}T23:59:59.999`).getTime()) return false
  return true
}
