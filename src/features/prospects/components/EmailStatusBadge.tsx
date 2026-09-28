import { Badge } from '../../../components/ui/Badge'
import type { EmailStatus } from '../../../server/prospecting/types'

const EMAIL_STATUS: Record<EmailStatus, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'default'; hint: string }> = {
  verified: { label: 'Verified', variant: 'success', hint: 'Mail server confirmed this mailbox exists' },
  format_confirmed: {
    label: 'Format confirmed',
    variant: 'info',
    hint: 'Domain accepts any address, but addresses already there use this format; can still bounce',
  },
  catch_all_likely: { label: 'Catch-all', variant: 'info', hint: 'Domain accepts any address; this is the most likely format' },
  risky: { label: 'Risky', variant: 'warning', hint: 'Mailbox may exist but could bounce' },
  unverified: { label: 'Unverified', variant: 'default', hint: 'Best guess; not checked against the mail server' },
  not_found: { label: 'Not found', variant: 'error', hint: 'No deliverable address found' },
}

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  const s = EMAIL_STATUS[status]
  return (
    <span title={s.hint}>
      <Badge variant={s.variant}>{s.label}</Badge>
    </span>
  )
}
