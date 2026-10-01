import type { EnrollmentStatus, SequenceStatus } from '../types'

type Variant = 'default' | 'success' | 'warning' | 'error' | 'info'

export const SEQUENCE_STATUS: Record<SequenceStatus, { label: string; variant: Variant }> = {
  draft: { label: 'Draft', variant: 'default' },
  active: { label: 'Running', variant: 'success' },
  paused: { label: 'Paused', variant: 'warning' },
  archived: { label: 'Archived', variant: 'default' },
}

export const ENROLLMENT_STATUS: Record<EnrollmentStatus, { label: string; variant: Variant }> = {
  active: { label: 'In progress', variant: 'info' },
  paused: { label: 'Paused', variant: 'warning' },
  replied: { label: 'Replied', variant: 'success' },
  finished: { label: 'Finished', variant: 'default' },
  unsubscribed: { label: 'Unsubscribed', variant: 'default' },
  bounced: { label: 'Bounced', variant: 'error' },
  stopped: { label: 'Stopped', variant: 'default' },
}

/** Why enrolling left people out, in words. */
export const SKIP_REASONS: Record<string, string> = {
  not_contact: "aren't contacts",
  unsubscribed: 'unsubscribed',
  bounced: 'bounced before',
  opted_out: 'opted out of being contacted',
  already_in: 'are already in this sequence',
  in_another: 'are in another running sequence',
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Tue 6 Oct, 09:40", in the viewer's own time. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')
