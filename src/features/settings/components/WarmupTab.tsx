import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Flame, Inbox } from 'lucide-react'
import { inboxWarmupFn, pauseWarmupFn, placementTestFn, resumeWarmupFn, startSenderCheckFn, startWarmupFn, stopWarmupFn, warmupPlacementFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsMore, SettingsPanel, SettingsRow } from './SettingsBlock'
import type { SettingsSection } from '../sections'
import type { PlacementTestResult, Tally, WarmupSender, WarmupSenderRow } from '../warmupTypes'

type Variant = 'default' | 'success' | 'warning' | 'error' | 'info'

/** The pool's word for how a sender is doing, in ours. */
const HEALTH: Record<string, { label: string; variant: Variant; about: string }> = {
  healthy: { label: 'Healthy', variant: 'success', about: '' },
  watch: { label: 'Watch', variant: 'warning', about: 'Too much of its warmup is landing in spam. Its sending limits hold until that improves.' },
  throttled: { label: 'Slowed', variant: 'warning', about: "Enough of its warmup lands in spam that it's sending half as much until that improves." },
  quarantined: { label: 'Held', variant: 'error', about: 'The pool has taken it out for a while: its mail drew complaints or bounced.' },
  blocked: { label: 'Blocked', variant: 'error', about: 'The pool has taken it out until it requalifies.' },
}

const GROUPS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft', yahoo: 'Yahoo', other: 'Other providers', all: 'All providers' }

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`

/** "86% inbox · 4% tabs · 10% spam", or how many more deliveries it needs. */
function landed(t: Tally, need = 0) {
  const total = t.inbox + t.tabs + t.spam
  if (total === 0) return 'Nothing delivered yet'
  if (total < need) return `${total} of the ${need} deliveries needed for a figure`
  return `${pct(t.inbox, total)} inbox · ${pct(t.tabs, total)} tabs · ${pct(t.spam, total)} spam (${total} delivered)`
}

/** What warmup is, for a workspace that has it and one that could add it, folded under the block's controls. */
function HowItWorks() {
  return (
    <SettingsMore>
      <p>
        A new sender that suddenly emails hundreds of strangers looks like a spammer to Gmail and Outlook. Warmup gives a sender a steady, growing
        stream of ordinary email with a pool of other real inboxes, which open it and reply to some of it. It's sent through our mail server,
        the same way as your campaigns, starting with a few a day and rising to about 20 over a month.
      </p>
      <p>
        The warmup that arrives in your inbox is filed in a folder called Mailivery, after the service that runs the pool. Keep warmup running alongside your
        campaigns. It helps, but it can't promise your email reaches the inbox: what you send, and who to, matters most.
      </p>
    </SettingsMore>
  )
}

/** Settings → Warmup: each sender's warmup in the host's pool, and where it lands; or, where it isn't on the plan, what adding it costs. */
export function WarmupTab({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  const { data, isLoading } = useQuery({ queryKey: queryKeys.settings.warmup(), queryFn: () => inboxWarmupFn(), refetchInterval: 60_000 })
  const [consentFor, setConsentFor] = useState<WarmupSenderRow | null>(null)

  if (isLoading || !data) return <SettingsEmpty>Loading…</SettingsEmpty>
  if (!data.offered && data.purchasable) {
    return (
      <SettingsPanel>
        <SettingsBlock title="Add it to your plan">
          <p className="text-sm leading-relaxed text-foreground">
            Inbox warmup isn't on your plan. Add it for {data.purchasable.price} a month: one sender warmed with up to {data.purchasable.perDay} emails a day.
          </p>
          <SettingsActions>
            <Button rightIcon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => onOpen('billing')}>
              Go to Plan and billing
            </Button>
          </SettingsActions>
          <HowItWorks />
        </SettingsBlock>
      </SettingsPanel>
    )
  }
  if (!data.offered) return <Notice>Inbox warmup isn't available on this workspace.</Notice>
  const warming = data.senders.filter((s) => s.warmup && s.warmup.state !== 'failed').length
  const one = data.maxSenders === 1

  return (
    <div className="flex flex-col gap-4">
      {data.stopped && <Notice level="error" title="MagpieCRM has stopped warmup for this workspace">{data.stopped}</Notice>}
      {data.error && <Notice level="error" title="The warmup service couldn't be reached">{data.error}</Notice>}
      <SettingsPanel>
        <SettingsBlock
          title="Senders"
          description={
            one
              ? 'One sender can warm at a time. It needs its own inbox connected under Reply detection, and SPF and DMARC records on its domain.'
              : `Up to ${data.maxSenders} senders can warm at once. Each needs its own inbox connected under Reply detection, and SPF and DMARC records on its domain.`
          }
        >
          {data.senders.length === 0 ? (
            <SettingsEmpty>Add a sender address first (Settings → Sender addresses).</SettingsEmpty>
          ) : (
            <SettingsList>
              {data.senders.map((s) => (
                <SenderWarmup
                  key={s.senderId}
                  row={s}
                  full={warming >= data.maxSenders ? (one ? 'One sender can warm at a time, and another is warming.' : 'As many senders as can warm at once are warming.') : null}
                  stopped={Boolean(data.stopped)}
                  onStart={() => setConsentFor(s)}
                />
              ))}
            </SettingsList>
          )}
          <HowItWorks />
        </SettingsBlock>

        {warming > 0 && <Placement />}

        {(warming > 0 || data.placementTests.last) && (
          <SenderCheck
            senders={data.senders.filter((s) => s.warmup && s.warmup.state !== 'failed').map((s) => s.email)}
            tests={data.placementTests}
            stopped={Boolean(data.stopped)}
          />
        )}
      </SettingsPanel>

      {consentFor && <Consent row={consentFor} consent={data.consent} onClose={() => setConsentFor(null)} />}
    </div>
  )
}

/** `full`: why no more can start, when as many as can warm are warming. */
function SenderWarmup({ row, full, stopped, onStart }: { row: WarmupSenderRow; full: string | null; stopped: boolean; onStart: () => void }) {
  const queryClient = useQueryClient()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.settings.warmup() })
  const pause = useMutation({ mutationFn: () => pauseWarmupFn({ data: { address: row.email } }), onSuccess: refresh })
  const resume = useMutation({ mutationFn: () => resumeWarmupFn({ data: { address: row.email } }), onSuccess: refresh })
  const [confirming, setConfirming] = useState(false)
  const stop = useMutation({
    mutationFn: () => stopWarmupFn({ data: { address: row.email } }),
    onSuccess: () => {
      setConfirming(false)
      refresh()
    },
  })
  const w = row.warmup
  const failed = (pause.error ?? resume.error ?? stop.error) as Error | null
  const on = w && w.state !== 'failed'

  const badge = !w ? (
    <Badge>Not warming</Badge>
  ) : w.state === 'warming' ? (
    <Badge variant="success">Warming</Badge>
  ) : w.state === 'starting' ? (
    <Badge variant="info">Starting</Badge>
  ) : w.state === 'paused' ? (
    <Badge variant="warning">Paused</Badge>
  ) : (
    <Badge variant="error">Couldn't start</Badge>
  )

  return (
    <SettingsRow
      icon={<Flame className="h-4 w-4" />}
      title={row.name || row.email}
      detail={[row.name ? row.email : null, w && on ? progress(w) : null].filter(Boolean).join(' · ') || undefined}
      badge={badge}
      actions={
        !on ? (
          <Button size="sm" onClick={onStart} disabled={row.blockers.length > 0 || Boolean(full) || stopped} title={full ?? undefined}>
            {w?.state === 'failed' ? 'Try again' : 'Start warmup'}
          </Button>
        ) : w.state === 'warming' ? (
          <Button size="sm" variant="outline" isLoading={pause.isPending} onClick={() => pause.mutate()}>
            Pause
          </Button>
        ) : w.state === 'paused' && w.pausedBy === 'you' ? (
          <Button size="sm" isLoading={resume.isPending} onClick={() => resume.mutate()}>
            Resume
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {!on && row.blockers.length > 0 && (
          <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
            {row.blockers.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
        )}
        {w?.state === 'failed' && w.reason && <Notice level="error">{w.reason}</Notice>}
        {w?.state === 'starting' && <p className="text-[13px] text-muted-foreground">Starting: the first warmup goes out within a few minutes, during the working day.</p>}
        {w?.state === 'paused' && w.pausedBy === 'us' && w.reason && <Notice level="warning" title="Paused by MagpieCRM">{w.reason}</Notice>}
        {on && w.health && HEALTH[w.health.state] && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Badge variant={HEALTH[w.health.state].variant}>{HEALTH[w.health.state].label}</Badge>
            <span>
              {HEALTH[w.health.state].about || 'Its warmup is landing well.'}
              {w.health.until ? ` Until ${new Date(w.health.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.` : ''}
            </span>
          </div>
        )}
        {on && w.week && (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            Last 7 days: {w.week.sent} sent · {w.week.replied} replied · {w.week.spam} found in spam
          </p>
        )}
        {on && w.partners !== null && (
          <p className="text-[13px] text-muted-foreground">The pool has {w.partners} partners for it today, so it sends fewer than its target.</p>
        )}
        {on && w.problem && <Notice level="error" title="Its warmup isn't sending">{w.problem}</Notice>}
        {failed && <Notice level="error">{failed.message}</Notice>}
        {on && (
          <SettingsActions>
            {confirming ? (
              <>
                <span className="text-[13px] text-muted-foreground">Stop warmup and take this inbox's login out of the pool?</span>
                <Button size="sm" variant="danger" isLoading={stop.isPending} onClick={() => stop.mutate()}>
                  Stop warmup
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Stop warmup
              </Button>
            )}
          </SettingsActions>
        )}
      </div>
    </SettingsRow>
  )
}

/** "12 of 18 today, day 6 of warmup" */
function progress(w: WarmupSender): string | null {
  const parts: string[] = []
  if (w.today) parts.push(w.today.target ? `${w.today.sent} of ${w.today.target} today` : `${w.today.sent} today`)
  if (w.daysActive) parts.push(`day ${w.daysActive}`)
  return parts.join(', ') || null
}

function Consent({ row, consent, onClose }: { row: WarmupSenderRow; consent: { version: string; points: string[] }; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [agreed, setAgreed] = useState(false)
  const start = useMutation({
    mutationFn: () => startWarmupFn({ data: { senderId: row.senderId, agreed: true, version: consent.version } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.warmup() })
      onClose()
    },
  })
  return (
    <Dialog isOpen onClose={onClose} title={`Warm up ${row.email}`} padded className="max-w-lg">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
          {consent.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I agree to this for {row.email}, and I'm allowed to for this mailbox.</span>
        </label>
        {start.error && <Notice level="error">{(start.error as Error).message}</Notice>}
        <SettingsActions>
          <Button disabled={!agreed} isLoading={start.isPending} onClick={() => start.mutate()}>
            Start warmup
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </SettingsActions>
      </div>
    </Dialog>
  )
}

/** The pool's seed inboxes, by their mail provider (its own ids). */
const PROVIDERS: Record<string, string> = {
  gmail: 'Gmail',
  google_workspace: 'Google Workspace',
  outlook: 'Outlook.com',
  microsoft365: 'Microsoft 365',
  yahoo: 'Yahoo',
  aol: 'AOL',
  icloud: 'iCloud',
  zoho: 'Zoho',
  fastmail: 'Fastmail',
  proton: 'Proton',
  gmx: 'GMX',
  other: 'Other',
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

/**
 * The month's sender check: one short, plain email (no links, images or
 * tracking) from a warming sender to the pool's test inboxes. An email like
 * that should reach the inbox, so where it lands says how the sender stands.
 */
function SenderCheck({ senders, tests, stopped }: { senders: string[]; tests: { used: number; limit: number; last: { id: string; at: string } | null }; stopped: boolean }) {
  const queryClient = useQueryClient()
  const [from, setFrom] = useState(senders[0] ?? '')
  const [started, setStarted] = useState<string | null>(null)
  const id = started ?? tests.last?.id ?? null
  const start = useMutation({
    mutationFn: () => startSenderCheckFn({ data: { address: from } }),
    onSuccess: (r) => {
      setStarted(r.id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.warmup() })
    },
  })
  const result = useQuery({
    queryKey: queryKeys.settings.placementTest(id ?? ''),
    queryFn: () => placementTestFn({ data: { id: id! } }),
    enabled: Boolean(id),
    refetchInterval: (q) => (!q.state.data || q.state.data.families.some((f) => f.waiting > 0) ? 15_000 : false),
  })
  // A failed check gives the month's back once the host has read it as failed.
  const failed = result.data?.status === 'failed' || result.data?.status === 'detection_failed'
  useEffect(() => {
    if (failed) void queryClient.invalidateQueries({ queryKey: queryKeys.settings.warmup() })
  }, [failed, queryClient])
  const usedUp = tests.used >= tests.limit
  const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()

  return (
    <SettingsBlock
      title="Sender check"
      description="Once a month, sends one short, plain email from your warming sender to about 20 test inboxes at Gmail, Outlook, Yahoo and others, through our mail server like a campaign. It has no links, images or tracking, so it should reach the inbox. Where it lands shows how your sender stands, whatever your campaigns say."
    >
      {id && (result.error ? <Notice level="error">{(result.error as Error).message}</Notice> : <CheckResult result={result.data ?? null} />)}
      {start.error && <Notice level="error">{(start.error as Error).message}</Notice>}
      <SettingsActions>
        {senders.length > 1 && (
          <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Sender to check">
            {senders.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <Button
          leftIcon={<Inbox className="h-4 w-4" />}
          isLoading={start.isPending}
          disabled={!from || usedUp || stopped}
          title={!from ? 'Start warmup on a sender first.' : usedUp ? `This month's check is used. Another from ${longDate(nextMonth)}.` : undefined}
          onClick={() => start.mutate()}
        >
          {senders.length === 1 ? `Check ${from}` : 'Run sender check'}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {usedUp ? `This month's check is used. Another from ${longDate(nextMonth)}.` : `${tests.limit - tests.used} left this month.`}
        </span>
      </SettingsActions>
    </SettingsBlock>
  )
}

/** A sender check's verdict, then where its copies landed at each provider. */
function CheckResult({ result }: { result: PlacementTestResult | null }) {
  const sum = (k: 'inbox' | 'tabs' | 'spam' | 'missing' | 'waiting') => (result?.families ?? []).reduce((n, f) => n + f[k], 0)
  const [inbox, tabs, spam, missing, waiting] = [sum('inbox'), sum('tabs'), sum('spam'), sum('missing'), sum('waiting')]
  const arrived = inbox + tabs + spam
  // The pool gave up without finding any copy: no verdict, and it isn't one of the month's.
  if (result && (result.status === 'failed' || result.status === 'detection_failed')) {
    return (
      <Notice level="warning" title="The check didn't finish">
        The test inboxes never reported back, so there's no result. It doesn't count as this month's check: run it again. {`Started ${longDate(result.startedAt)}.`}
      </Notice>
    )
  }
  // Nothing counted either way yet: no verdict to give.
  if (!result || arrived + missing + waiting === 0) return <p className="text-[13px] text-muted-foreground">Sent. Waiting for the first answers…</p>
  const where = (k: 'spam' | 'missing') => result.families.filter((f) => f[k] > 0).map((f) => PROVIDERS[f.family] ?? f.family).join(', ')
  const when = `Checked ${longDate(result.startedAt)}.`
  return (
    <div className="flex flex-col gap-3">
      {waiting > 0 ? (
        <Notice level="info" title="Still looking">
          {arrived} of {arrived + missing + waiting} found so far. The rest are looked for over the next few minutes.
        </Notice>
      ) : spam > 0 ? (
        <Notice level="error" title={`${spam} of ${arrived + missing} landed in spam`}>
          At {where('spam')}. An email this plain shouldn't go to spam, so it's the sender being held back there: its domain, or our mail server's
          standing with that provider, not your wording. Keep warmup running and check again next month. {when}
        </Notice>
      ) : missing > 0 ? (
        <Notice level="warning" title={`${missing} of ${arrived + missing} never arrived`}>
          At {where('missing')}. None went to spam, but some providers didn't deliver it at all. {when}
        </Notice>
      ) : (
        <Notice level="success" title="It reached the inbox">
          All {arrived} arrived{tabs > 0 ? `, ${tabs} of them in a tab like Promotions` : ''}, and none went to spam. {when}
        </Notice>
      )}
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-medium">Provider</th>
            <th className="py-1 text-right font-medium">Inbox</th>
            <th className="py-1 text-right font-medium">Tabs</th>
            <th className="py-1 text-right font-medium">Spam</th>
            <th className="py-1 text-right font-medium">Missing</th>
          </tr>
        </thead>
        <tbody>
          {result.families.map((f) => (
            <tr key={f.family} className="border-t border-border">
              <td className="py-1.5 text-foreground">{PROVIDERS[f.family] ?? f.family}</td>
              <td className="py-1.5 text-right">{f.inbox}</td>
              <td className="py-1.5 text-right">{f.tabs}</td>
              <td className={`py-1.5 text-right ${f.spam ? 'text-destructive' : ''}`}>{f.spam}</td>
              <td className="py-1.5 text-right text-muted-foreground">{f.waiting ? `${f.missing} (+${f.waiting} to come)` : f.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Where warmup has landed over the last 7 days: each sender at the big three, and each provider. */
function Placement() {
  const { data, error } = useQuery({ queryKey: queryKeys.settings.warmupPlacement(), queryFn: () => warmupPlacementFn({ data: { days: 7 } }) })
  const byGroup = new Map<string, Tally>()
  for (const d of data?.daily ?? []) {
    const t = byGroup.get(d.group) ?? { inbox: 0, tabs: 0, spam: 0 }
    t.inbox += d.inbox
    t.tabs += d.tabs
    t.spam += d.spam
    byGroup.set(d.group, t)
  }
  return (
    <SettingsBlock
      title="Where warmup lands"
      description="Each warmup email is looked for in the inbox it went to. The figure is taken at Google, Microsoft and Yahoo, which judge senders, once 20 have arrived there in the last 7 days. Tabs (like Gmail's Promotions) count as arrived, not spam."
    >
      {error ? (
        <Notice level="error">{(error as Error).message}</Notice>
      ) : !data ? (
        <SettingsEmpty>Loading…</SettingsEmpty>
      ) : data.senders.length === 0 ? (
        <SettingsEmpty>Nothing yet.</SettingsEmpty>
      ) : (
        <div className="flex flex-col gap-3">
          <SettingsList>
            {data.senders.map((s) => (
              <SettingsRow key={s.address} title={s.address}>
                <p className="text-[13px] text-muted-foreground tabular-nums">Google, Microsoft and Yahoo: {landed(s.major, 20)}</p>
              </SettingsRow>
            ))}
          </SettingsList>
          {byGroup.size > 0 && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {[...byGroup].map(([group, t]) => (
                <div key={group} className="flex justify-between gap-3 tabular-nums">
                  <dt className="text-muted-foreground">{GROUPS[group] ?? group}</dt>
                  <dd className="text-foreground">{landed(t)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </SettingsBlock>
  )
}
