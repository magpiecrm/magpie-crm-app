import { Link } from '@tanstack/react-router'
import { Mail, StickyNote } from 'lucide-react'
import { Avatar } from '../../../../components/ui/Avatar'
import { Badge } from '../../../../components/ui/Badge'
import { Button } from '../../../../components/ui/Button'
import { FollowUpButton } from '../../../sales/components/TaskParts'
import type { CompanyView } from '../../../sales/types'
import { formatDay } from '../../record'
import { emailStatus, type RecordContact } from './ContactSidebar'

/** Who the contact is, whether email reaches them, and the page's main actions. */
export function ContactHeader({
  contact,
  name,
  company,
  onEmail,
  onNote,
}: {
  contact: RecordContact
  /** Their name, or empty when only the address is known. */
  name: string
  company: CompanyView | null
  onEmail: () => void
  onNote: () => void
}) {
  const status = emailStatus(contact.status)
  const job = contact.attributes.JOB_TITLE
  const companyName = company?.name || contact.attributes.COMPANY
  const companyNode = companyName ? (
    company ? (
      <Link to="/marketing/companies/$id" params={{ id: company.id }} className="font-medium text-foreground hover:text-accent hover:underline">
        {companyName}
      </Link>
    ) : (
      <span className="font-medium text-foreground">{companyName}</span>
    )
  ) : null

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <Avatar name={name || contact.email} size="lg" />
        <div className="min-w-0 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className={`min-w-0 text-2xl font-semibold tracking-tight text-foreground ${name ? 'break-words' : 'break-all'}`}>{name || contact.email}</h1>
            {status.tone !== 'good' && (
              <Badge variant={status.tone === 'bad' ? 'error' : 'warning'} status>
                {status.label}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {job && companyNode ? (
              <>
                {job} at {companyNode}
              </>
            ) : job ? (
              job
            ) : companyNode ? (
              companyNode
            ) : (
              `Added ${formatDay(contact.createdAt)}`
            )}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onNote} leftIcon={<StickyNote className="h-3.5 w-3.5" />}>
          Note
        </Button>
        <FollowUpButton on={{ contactEmail: contact.email }} name={name || contact.email} />
        <Button size="sm" variant={status.tone === 'good' ? 'primary' : 'secondary'} onClick={onEmail} leftIcon={<Mail className="h-3.5 w-3.5" />}>
          Email
        </Button>
      </div>
    </header>
  )
}
