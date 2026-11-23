import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Copy, Mail, PenLine, Trash2 } from 'lucide-react'
import { tasksFn } from '../../../../server/functions'
import { queryKeys } from '../../../../queryKeys'
import { ActionMenu } from '../../../../components/ui/ActionMenu'
import { Avatar } from '../../../../components/ui/Avatar'
import { Badge } from '../../../../components/ui/Badge'
import { Button } from '../../../../components/ui/Button'
import { FollowUpButton } from '../../../sales/components/TaskParts'
import { dueBucket } from '../../../sales/tasks'
import { formatMoney, type CompanyView, type DealView } from '../../../sales/types'
import { formatAgo, formatDay, formatWhen, type FeedItem } from '../../record'
import { emailStatus, type RecordContact } from './ContactSidebar'

/** One fact in the strip under the name: a label, then the fact. */
function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 py-2.5 pr-4 sm:border-l sm:border-border sm:px-4 sm:first:border-l-0 sm:first:pl-0 ${wide ? 'col-span-2 sm:flex-1' : ''}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{children}</dd>
    </div>
  )
}

/** Who the contact is, where things stand with them, and the page's main actions. */
export function ContactHeader({
  contact,
  name,
  company,
  deals,
  feed,
  nextEmailAt,
  repliedAt,
  onEmail,
  onNote,
  onCopy,
  onDelete,
}: {
  contact: RecordContact
  /** Their name, or empty when only the address is known. */
  name: string
  company: CompanyView | null
  deals: DealView[]
  feed: FeedItem[]
  /** When their next sequence email goes, if one is due. */
  nextEmailAt: string | null
  /** When they last replied to a sequence, as their enrolments have it. */
  repliedAt: string | null
  onEmail: () => void
  onNote: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const on = { contactEmail: contact.email }
  const { data: tasks = [] } = useQuery({ queryKey: queryKeys.sales.tasks(on), queryFn: () => tasksFn({ data: on }) })
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

  const lastEmail = feed.find((i) => i.kind === 'campaign' || i.kind === 'sequence')
  const lastReply = [repliedAt, ...feed.map((i) => i.replied)].filter((at): at is string => Boolean(at)).sort().at(-1)
  const nextTask = tasks
    .filter((t) => !t.done_at && t.due_at)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0]
  const open = deals.filter((d) => d.status === 'open')
  const openValue = open.reduce((sum, d) => sum + d.value, 0)

  return (
    <header>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar name={name || contact.email} size="lg" />
          <div className="min-w-0">
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
              ) : (
                job || companyNode || `Added ${formatDay(contact.createdAt)}`
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onNote} leftIcon={<PenLine className="h-3.5 w-3.5" />}>
            Note
          </Button>
          <FollowUpButton on={on} name={name || contact.email} />
          <Button size="sm" onClick={onEmail} leftIcon={<Mail className="h-3.5 w-3.5" />}>
            Email
          </Button>
          <ActionMenu
            label={`More actions for ${name || contact.email}`}
            triggerClassName="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md-xs border border-control bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.06)] hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-white/[0.04] dark:shadow-none"
            items={[
              { label: 'Copy email address', icon: Copy, onSelect: onCopy },
              'separator',
              { label: 'Delete contact', icon: Trash2, onSelect: onDelete, tone: 'danger' },
            ]}
          />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-y-1 rounded-xl border border-border bg-card px-4 sm:flex sm:flex-wrap sm:px-5">
        <Fact label="Next step" wide>
          {nextTask ? (
            <span title={`${nextTask.body}, due ${formatWhen(nextTask.due_at!)}`}>
              {dueBucket(nextTask.due_at) === 'overdue' ? <span className="text-destructive">Overdue</span> : formatDay(nextTask.due_at!)}
              <span className="font-normal text-muted-foreground"> · </span>
              {nextTask.body}
            </span>
          ) : nextEmailAt ? (
            <span title={formatWhen(nextEmailAt)}>Sequence email {formatDay(nextEmailAt)}</span>
          ) : (
            <span className="font-normal text-muted-foreground">Nothing planned</span>
          )}
        </Fact>
        <Fact label="Last emailed">
          {lastEmail ? (
            <span title={formatWhen(lastEmail.at)}>{formatAgo(lastEmail.at)}</span>
          ) : (
            <span className="font-normal text-muted-foreground">Never</span>
          )}
        </Fact>
        <Fact label="Last reply">
          {lastReply ? (
            <span title={formatWhen(lastReply)}>{formatAgo(lastReply)}</span>
          ) : (
            <span className="font-normal text-muted-foreground">None yet</span>
          )}
        </Fact>
        <Fact label="Open deals">
          {open.length ? (
            <span className="tabular-nums">
              {formatMoney(openValue, open[0].currency)}
              <span className="font-normal text-muted-foreground"> · {open.length}</span>
            </span>
          ) : (
            <span className="font-normal text-muted-foreground">None</span>
          )}
        </Fact>
      </dl>
    </header>
  )
}
