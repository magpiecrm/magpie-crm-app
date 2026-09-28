/**
 * What to tell the user after a campaign goes out: how many it reached,
 * anyone skipped for opting out, and any unverified addresses held back
 * after a first batch (server/guessedRecipients.ts).
 */
export function sentMessage(res: { sentCount?: number; skippedOptOuts?: number; heldBack?: number } | undefined): string {
  const n = res?.sentCount
  if (typeof n !== 'number') return 'Campaign sent successfully!'
  const skipped = res?.skippedOptOuts ?? 0
  const held = res?.heldBack ?? 0
  return (
    `Campaign sent to ${n} recipient${n === 1 ? '' : 's'}.` +
    (skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} skipped: they opted out of being contacted.` : '') +
    (held
      ? ` ${held} more with unverified addresses follow once the first ones show they aren't bouncing.`
      : '')
  )
}
