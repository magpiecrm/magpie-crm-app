/** What to tell the user after a campaign goes out: how many it reached, and anyone skipped for opting out. */
export function sentMessage(res: { sentCount?: number; skippedOptOuts?: number } | undefined): string {
  const n = res?.sentCount
  if (typeof n !== 'number') return 'Campaign sent successfully!'
  const skipped = res?.skippedOptOuts ?? 0
  return (
    `Campaign sent to ${n} recipient${n === 1 ? '' : 's'}.` +
    (skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} skipped: they opted out of being contacted.` : '')
  )
}
