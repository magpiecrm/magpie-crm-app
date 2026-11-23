import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlarmClock, Check, Copy, Mail, PenLine, Plus, Trash2 } from 'lucide-react'
import { tasksFn, updateTaskFn } from '../../../../server/functions'
import { queryKeys } from '../../../../queryKeys'
import { ActionMenu } from '../../../../components/ui/ActionMenu'
import { Avatar } from '../../../../components/ui/Avatar'
import { Button } from '../../../../components/ui/Button'
import { SECTION_ACTION } from '../../../../components/ui/RecordSection'
import { FollowUpButton, useTasksChanged } from '../../../sales/components/TaskParts'
import { dueBucket } from '../../../sales/tasks'
import { formatMoney, type CompanyView, type DealView } from '../../../sales/types'
import { formatAgo, formatDay, formatWhen, type FeedItem } from '../../record'
import { emailStatus, type RecordContact } from './ContactSidebar'

const STATUS_BADGE = {
  warn: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  bad: 'bg-destructive/10 text-destructive',
}

/** One number or fact in the strip under the name. */
function Stat({ label, children, empty }: { label: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3 border-l border-border first:border-l-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate ${empty ? 'text-sm text-muted-foreground' : 'text-base font-semibold text-foreground'}`}>{children}</dd>
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
  onAddTask,
  onShowActivity,
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
  onAddTask: () => void
  onShowActivity: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const on = { contactEmail: contact.email }
  const { data: tasks = [] } = useQuery({ queryKey: queryKeys.sales.tasks(on), queryFn: () => tasksFn({ data: on }) })
  const changed = useTasksChanged()
  const complete = useMutation({ mutationFn: (id: string) => updateTaskFn({ data: { id, done: true } }), onSuccess: changed })
  const status = emailStatus(contact.status)
  const job = contact.attributes.JOB_TITLE
  // Their own company field first: the record they're grouped under (by email domain) can be another name.
  const typed = contact.attributes.COMPANY.trim()
  const companyName = typed || company?.name || ''
  const sameCompany = Boolean(company) && (!typed || typed.toLowerCase() === company!.name.trim().toLowerCase())
  const companyNode = companyName ? (
    company && sameCompany ? (
      <Link
        to="/marketing/companies/$id"
        params={{ id: company!.id }}
        className="font-medium text-foreground underline decoration-foreground/25 underline-offset-4 hover:text-accent hover:decoration-accent"
      >
        {companyName}
      </Link>
    ) : (
      <span className="font-medium text-foreground">{companyName}</span>
    )
  ) : null

  const lastEmail = feed.find((i) => i.kind === 'campaign' || i.kind === 'sequence')
  const lastReply = [repliedAt, ...feed.map((i) => i.replied ?? (i.kind === 'reply' ? i.at : undefined))]
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1)
  const nextTask = tasks.filter((t) => !t.done_at && t.due_at).sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0]
  const overdue = nextTask && dueBucket(nextTask.due_at) === 'overdue'
  const open = deals.filter((d) => d.status === 'open')
  const openValue = open.reduce((sum, d) => sum + d.value, 0)
  const nothing = !nextTask && !nextEmailAt && !lastEmail && !lastReply && open.length === 0

  return (
    <header>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar name={name || contact.email} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className={`min-w-0 text-2xl font-semibold tracking-tight text-foreground ${name ? 'break-words' : 'break-all'}`}>{name || contact.email}</h1>
              {status.tone !== 'good' && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status.tone]}`}>
                  <status.Icon aria-hidden className="h-3.5 w-3.5" />
                  {status.label}
                </span>
              )}
            </div>
            {(job || companyNode) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {job && companyNode ? (
                  <>
                    {job} at {companyNode}
                  </>
                ) : (
                  job || companyNode
                )}
              </p>
            )}
            {name && (
              <p className="mt-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{contact.email}</span>
                <button
                  type="button"
                  onClick={onCopy}
                  aria-label="Copy email address"
                  title="Copy email address"
                  className="touch-target shrink-0 rounded-md-xs p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onNote} leftIcon={<PenLine className="h-3.5 w-3.5" />}>
            Note
          </Button>
          <FollowUpButton on={on} name={name || contact.email} />
          {status.tone === 'good' ? (
            <Button size="sm" onClick={onEmail} leftIcon={<Mail className="h-3.5 w-3.5" />}>
              Email
            </Button>
          ) : (
            // Can't send: the button says so, and points at the notice that explains.
            <span title={`They’re ${status.label.toLowerCase()}, so email won’t send`}>
              <Button size="sm" variant="secondary" disabled aria-describedby="contact-email-blocked" leftIcon={<status.Icon className="h-3.5 w-3.5" />}>
                Email
              </Button>
            </span>
          )}
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

      {nothing ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
          <p className="text-sm text-muted-foreground">Nothing planned, sent or open with them yet.</p>
          <button type="button" onClick={onAddTask} className={SECTION_ACTION}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Add task
          </button>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,1.7fr)_minmax(0,3fr)]">
          <div className="min-w-0 px-4 py-3 sm:px-5">
            <p className="text-xs text-muted-foreground">Next step</p>
            {nextTask ? (
              <div className="mt-0.5 flex min-w-0 items-start gap-2">
                <button
                  type="button"
                  onClick={() => complete.mutate(nextTask.id)}
                  disabled={complete.isPending}
                  aria-label={`Mark “${nextTask.body}” done`}
                  title="Mark done"
                  className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-input text-transparent hover:border-accent hover:text-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </button>
                <p className="min-w-0 text-sm font-medium leading-6 text-foreground line-clamp-2 lg:line-clamp-1" title={nextTask.body}>
                  {overdue ? (
                    <span className="mr-1.5 text-destructive">
                      <AlarmClock aria-hidden className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
                      Overdue
                    </span>
                  ) : (
                    <span className="mr-1.5 text-muted-foreground" title={formatWhen(nextTask.due_at!)}>
                      {formatDay(nextTask.due_at!)}
                    </span>
                  )}
                  {nextTask.body}
                </p>
              </div>
            ) : nextEmailAt ? (
              <p className="mt-0.5 text-sm font-medium leading-6 text-foreground" title={formatWhen(nextEmailAt)}>
                Sequence email {formatWhen(nextEmailAt)}
              </p>
            ) : (
              <button type="button" onClick={onAddTask} className={`${SECTION_ACTION} -ml-1.5 mt-0.5`}>
                <Plus aria-hidden className="h-3.5 w-3.5" />
                Add task
              </button>
            )}
          </div>
          <dl className="grid grid-cols-3 border-t border-border lg:border-l lg:border-t-0">
            <Stat label="Last emailed" empty={!lastEmail}>
              {lastEmail ? (
                <button type="button" onClick={onShowActivity} title={formatWhen(lastEmail.at)} className="hover:text-accent hover:underline cursor-pointer">
                  {formatAgo(lastEmail.at)}
                </button>
              ) : (
                'Never'
              )}
            </Stat>
            <Stat label="Last reply" empty={!lastReply}>
              {lastReply ? (
                <button type="button" onClick={onShowActivity} title={formatWhen(lastReply)} className="hover:text-accent hover:underline cursor-pointer">
                  {formatAgo(lastReply)}
                </button>
              ) : (
                'Never'
              )}
            </Stat>
            <Stat label="Open deals" empty={open.length === 0}>
              {open.length === 1 ? (
                <Link to="/sales/deals/$id" params={{ id: open[0].id }} className="tabular-nums hover:text-accent hover:underline" title={open[0].name}>
                  {formatMoney(openValue, open[0].currency)}
                </Link>
              ) : open.length > 1 ? (
                <span className="tabular-nums" title={`${open.length} open deals`}>
                  {formatMoney(openValue, open[0].currency)}
                  <span className="text-sm font-normal text-muted-foreground"> · {open.length}</span>
                </span>
              ) : (
                'None'
              )}
            </Stat>
          </dl>
        </div>
      )}
    </header>
  )
}
