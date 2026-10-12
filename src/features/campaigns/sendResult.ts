import { everyText } from './batches'

/**
 * What to tell the user after a campaign goes out: how many it reached,
 * anyone skipped for opting out, any unverified addresses held back after a
 * first batch (server/guessedRecipients.ts), and anyone left for its later
 * batches, or for the coming days by the daily sending limit
 * (server/sendingLimits.ts).
 */
export function sentMessage(
  res: { sentCount?: number; skippedOptOuts?: number; heldBack?: number; later?: number; batches?: { size: number; everyMinutes: number } } | undefined,
): string {
  const n = res?.sentCount
  if (typeof n !== 'number') return 'Campaign sent successfully!'
  const skipped = res?.skippedOptOuts ?? 0
  const held = res?.heldBack ?? 0
  const later = res?.later ?? 0
  const people = (count: number) => `${count} recipient${count === 1 ? '' : 's'}`
  const tail =
    (skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} skipped: they opted out of being contacted.` : '') +
    (held ? ` ${held} more with unverified addresses follow once the first ones show they aren't bouncing.` : '')
  if (res?.batches && later) {
    return `First batch sent to ${people(n)}. The other ${later} follow by themselves, ${res.batches.size} ${everyText(res.batches.everyMinutes)}.${tail}`
  }
  return (
    (later && !n
      ? `Today's sending limit is used up, so this campaign starts sending tomorrow (${people(later)}).`
      : `Campaign sent to ${people(n)}${later ? ' today' : ''}.`) +
    (later && n ? ` The other ${later} follow automatically from tomorrow, as your daily sending limit allows (Settings shows the limit and when it goes up).` : '') +
    tail
  )
}
