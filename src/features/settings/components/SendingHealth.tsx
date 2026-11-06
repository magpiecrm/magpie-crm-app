import { useQuery } from '@tanstack/react-query'
import { Globe } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getSendingHealthFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Notice } from '../../../components/ui/Notice'
import { SettingsBlock, SettingsEmpty, SettingsList, SettingsMore, SettingsRow } from './SettingsBlock'

type Health = Awaited<ReturnType<typeof getSendingHealthFn>>
type Limit = NonNullable<Health['limits']>['cold']
type Status = Health['domains'][number]['status']

const STATUS: Record<Status, { label: string; variant: 'success' | 'warning' | 'error' | 'default' }> = {
  good: { label: 'Good', variant: 'success' },
  at_risk: { label: 'At risk', variant: 'warning' },
  poor: { label: 'Poor', variant: 'error' },
  unknown: { label: 'Not enough sent yet', variant: 'default' },
}

/** The score's colour follows its status. */
const SCORE_CLASS: Record<Status, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  at_risk: 'text-amber-700 dark:text-amber-400',
  poor: 'text-destructive',
  unknown: 'text-muted-foreground',
}

const count = (n: number) => n.toLocaleString()
const short = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%')

/** Both daily limits as a table: what's gone out today against the limit, and the next step, so the numbers line up to compare. */
function LimitsTable({ rows }: { rows: Array<{ name: string; about: string; limit: Limit }> }) {
  return (
    <div className="overflow-x-auto rounded-md-s border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="text-[13px] text-muted-foreground">
          <tr className="border-b border-border/70">
            <th className="px-3.5 py-2 font-medium">Email</th>
            <th className="whitespace-nowrap px-3.5 py-2 text-right font-medium">Sent, 24 h</th>
            <th className="px-3.5 py-2 font-medium">Next step</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map(({ name, about, limit }) => (
            <tr key={name} className="align-top">
              <td className="px-3.5 py-2.5">
                <p className="font-medium text-foreground">{name}</p>
                <p className="text-[13px] text-muted-foreground">{about}</p>
              </td>
              <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums">
                {limit.limit === null ? (
                  <span className="text-muted-foreground">No limit</span>
                ) : (
                  <>
                    <span className="font-semibold text-foreground">{count(limit.sent)}</span>
                    <span className="text-muted-foreground"> of {count(limit.limit)}</span>
                  </>
                )}
              </td>
              <td className="px-3.5 py-2.5 text-[13px] text-muted-foreground">
                {limit.limit === null
                  ? 'Your plan’s monthly allowance is the only limit'
                  : limit.setByHost
                    ? 'Set for your workspace'
                    : limit.nextStepAt
                      ? limit.status === 'poor'
                        ? `Goes down ${short(limit.nextStepAt)} unless it improves`
                        : (
                            <>
                              <span className="font-medium text-foreground">{limit.nextLimit === null ? 'No limit' : `${count(limit.nextLimit)} a day`}</span>{' '}
                              from {short(limit.nextStepAt)}, if received well
                            </>
                          )
                      : 'This is the most a workspace sends in a day'}
                {limit.score !== null && <span className={`ml-2 font-semibold tabular-nums ${SCORE_CLASS[limit.status]}`}>Reputation {limit.score}%</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Settings → Sending, where the host's mail server sends: the daily sending
 * limits and how each sending domain's email has been received. Two blocks
 * for ManagedSending's panel, not a panel of its own.
 */
export function SendingHealth() {
  const { data } = useQuery({ queryKey: queryKeys.settings.sendingHealth(), queryFn: () => getSendingHealthFn() })
  if (!data?.limits) return null
  return (
    <>
      <SettingsBlock
        title="Daily limits"
        description="Limits start low and go up each week your email is received well, because mail providers trust a sender that grows slowly."
      >
        <LimitsTable
          rows={[
            { name: 'Cold email', about: "People found in Prospect Search who haven't signed up or replied", limit: data.limits.cold },
            { name: 'Opt-in email', about: 'People who signed up, and contacts you imported', limit: data.limits.optIn },
          ]}
        />
        {[data.limits.cold, data.limits.optIn].some((l) => l.limit !== null && l.left === 0) && (
          <Notice level="warning">Today’s limit is used up: campaigns carry on tomorrow by themselves, and sequences wait.</Notice>
        )}
        <SettingsMore summary="How limits grow">
          <p>
            Each limit is looked at again once a week. If that week's email was received well, it steps up to the next one shown; if
            it was received badly, it steps down. A limit set for your workspace stays as it is.
          </p>
        </SettingsMore>
      </SettingsBlock>

      <SettingsBlock
        title="Reputation"
        description={`How each domain you send from has been received over the last ${data.windowDays} days: 80% and over is good, under 50% poor.`}
      >
        {data.domains.length === 0 ? (
          <SettingsEmpty>Nothing sent in the last {data.windowDays} days.</SettingsEmpty>
        ) : (
          <SettingsList>
            {data.domains.map((d) => (
              <SettingsRow
                key={d.domain}
                icon={<Globe className="h-4 w-4" />}
                title={d.domain}
                badge={<Badge variant={STATUS[d.status].variant} status>{STATUS[d.status].label}</Badge>}
                actions={
                  d.score !== null && (
                    <span className={`text-2xl font-semibold tabular-nums leading-none ${SCORE_CLASS[d.status]}`} aria-label={`Reputation score ${d.score} out of 100`}>
                      {d.score}%
                    </span>
                  )
                }
              >
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] text-muted-foreground tabular-nums">
                    {count(d.stats.sent)} sent · {count(d.stats.hardBounces)} bounced · {count(d.stats.complaints)} marked as spam ·{' '}
                    {count(d.stats.unsubscribes)} unsubscribed
                    {d.stats.tracked > 0 && ` · ${percent(d.stats.opened, d.stats.tracked)} opened`}
                    {d.stats.replies > 0 && ` · ${count(d.stats.replies)} replied`}
                  </p>
                  {d.status === 'unknown' && (
                    <p className="text-[13px] text-muted-foreground">A status needs at least {data.minSample} emails sent in the last {data.windowDays} days.</p>
                  )}
                  {d.reasons.map((r) => (
                    <Notice key={r.code} level={r.level === 'poor' ? 'error' : 'warning'} title={r.text}>
                      {r.fix}
                    </Notice>
                  ))}
                </div>
              </SettingsRow>
            ))}
          </SettingsList>
        )}
        <SettingsMore>
          <p>
            The score is set by the weakest of bounces, spam complaints, unsubscribes and opens; 50% to 79% is at risk. Opens
            leave out security scanners, and count only email sent with open tracking on.
          </p>
        </SettingsMore>
      </SettingsBlock>
    </>
  )
}
