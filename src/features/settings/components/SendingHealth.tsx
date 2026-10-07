import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { getSendingHealthFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { SettingsBlock } from './SettingsBlock'

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

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const count = (n: number) => n.toLocaleString()
const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%')

/** One kind of mail's limit: how much of today's is used, and when it next goes up. */
function LimitRow({ name, about, limit }: { name: string; about: string; limit: Limit }) {
  const used = limit.limit === null ? 0 : Math.min(1, limit.sent / Math.max(1, limit.limit))
  return (
    <div className="border border-border rounded-md-s bg-muted/20 p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-foreground">{name}</span>
        <span className="text-xs text-muted-foreground">{about}</span>
        {limit.score !== null && (
          <span className={`text-xs font-semibold tabular-nums ${SCORE_CLASS[limit.status]}`} title="Reputation score for this kind of email, last 7 days">
            Reputation {limit.score}%
          </span>
        )}
        <span className="ml-auto text-sm font-semibold text-foreground tabular-nums">
          {limit.limit === null ? 'No daily limit' : `${count(limit.sent)} of ${count(limit.limit)} sent in the last 24 hours`}
        </span>
      </div>
      {limit.limit !== null && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="presentation">
          <div className={`h-full rounded-full ${used >= 1 ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: `${Math.round(used * 100)}%` }} />
        </div>
      )}
      <p className="text-xs text-muted-foreground leading-relaxed">
        {limit.limit === null
          ? 'Your plan’s monthly allowance is the only limit.'
          : limit.setByHost
            ? 'This limit was set for your workspace.'
            : limit.nextStepAt
              ? limit.status === 'poor'
                ? `It was received badly this week, so the limit goes down on ${day(limit.nextStepAt)} unless that improves.`
                : limit.status === 'good'
                  ? `Goes up to ${limit.nextLimit === null ? 'no daily limit' : `${count(limit.nextLimit)} a day`} on ${day(limit.nextStepAt)}, if it keeps being received well.`
                  : `Looked at again on ${day(limit.nextStepAt)}: it goes up to ${limit.nextLimit === null ? 'no daily limit' : `${count(limit.nextLimit)} a day`} once a week's email has been received well.`
              : 'This is the most cold email a workspace sends in a day.'}
        {limit.limit !== null && limit.left === 0 && ' Today’s is used up: campaigns carry on tomorrow by themselves, and sequences wait.'}
      </p>
    </div>
  )
}

/**
 * Settings → Sending, where the host's mail server sends: the daily sending
 * limits and how each sending domain's email has been received.
 */
export function SendingHealth() {
  const { data } = useQuery({ queryKey: queryKeys.settings.sendingHealth(), queryFn: () => getSendingHealthFn() })
  if (!data?.limits) return null
  return (
    <>
      <SettingsBlock
        title="Daily sending limits"
        description="A new sender that starts small and grows is trusted by Gmail and Outlook; one that sends everything at once is filed as spam. So limits start low and go up each week your email is received well."
      >
        <LimitRow name="Cold email" about="To people found in Prospect Search who haven't signed up or replied" limit={data.limits.cold} />
        <LimitRow name="Opt-in email" about="To people who signed up, and contacts you imported" limit={data.limits.optIn} />
      </SettingsBlock>

      <SettingsBlock
        title="How your email is received"
        description={`A score out of 100% for each domain you send from, from the last ${data.windowDays} days: 80% and over is good, 50% to 79% at risk, under 50% poor. It's set by the weakest of bounces, spam complaints, unsubscribes and opens. Opens leave out security scanners, and count only email sent with open tracking on.`}
      >
        {data.domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent in the last {data.windowDays} days.</p>
        ) : (
          data.domains.map((d) => (
            <div key={d.domain} className="border border-border rounded-md-s bg-muted/20 p-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-foreground">{d.domain}</span>
                <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
                {d.score !== null && (
                  <span className={`ml-auto text-2xl font-semibold tabular-nums leading-none ${SCORE_CLASS[d.status]}`} aria-label={`Reputation score ${d.score} out of 100`}>
                    {d.score}%
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {count(d.stats.sent)} sent · {count(d.stats.hardBounces)} bounced · {count(d.stats.complaints)} marked as spam ·{' '}
                {count(d.stats.unsubscribes)} unsubscribed
                {d.stats.tracked > 0 && ` · ${percent(d.stats.opened, d.stats.tracked)} opened`}
                {d.stats.replies > 0 && ` · ${count(d.stats.replies)} replied`}
              </p>
              {d.status === 'unknown' && (
                <p className="text-xs text-muted-foreground">A status needs at least {data.minSample} emails sent in the last {data.windowDays} days.</p>
              )}
              {d.reasons.map((r) => (
                <div key={r.code} className={`text-xs leading-relaxed ${r.level === 'poor' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}`}>
                  <p className="font-semibold">{r.text}</p>
                  <p className="text-muted-foreground">{r.fix}</p>
                </div>
              ))}
            </div>
          ))
        )}
      </SettingsBlock>
    </>
  )
}
