import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flame } from 'lucide-react'
import { inboxWarmupFn, pauseWarmupFn, resumeWarmupFn, startWarmupFn, stopWarmupFn, warmupPlacementFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'
import type { Tally, WarmupSender, WarmupSenderRow } from '../warmupTypes'

type Variant = 'default' | 'success' | 'warning' | 'error' | 'info'

/** The pool's word for how a sender is doing, in ours. */
const HEALTH: Record<string, { label: string; variant: Variant; about: string }> = {
  healthy: { label: 'Healthy', variant: 'success', about: '' },
  watch: { label: 'Watch', variant: 'warning', about: 'Some of its warmup is landing in spam, so the pool is replying to and rescuing more of it.' },
  throttled: { label: 'Slowed', variant: 'warning', about: "Enough of its warmup lands in spam that it's sending half as much until that improves." },
  quarantined: { label: 'Held', variant: 'error', about: 'The pool has taken it out for a while: its mail drew complaints or bounced.' },
  blocked: { label: 'Blocked', variant: 'error', about: 'The pool has taken it out until it requalifies.' },
}

const GROUPS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft', yahoo: 'Yahoo', other: 'Other providers' }

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`

/** "86% inbox · 4% tabs · 10% spam", or how many more deliveries it needs. */
function landed(t: Tally, need = 0) {
  const total = t.inbox + t.tabs + t.spam
  if (total === 0) return 'Nothing delivered yet'
  if (total < need) return `${total} of the ${need} deliveries needed for a figure`
  return `${pct(t.inbox, total)} inbox · ${pct(t.tabs, total)} tabs · ${pct(t.spam, total)} spam (${total} delivered)`
}

/** Settings → Warmup: each sender's warmup in the host's pool, and where it lands. */
export function WarmupTab() {
  const { data, isLoading } = useQuery({ queryKey: queryKeys.settings.warmup(), queryFn: () => inboxWarmupFn(), refetchInterval: 60_000 })
  const [consentFor, setConsentFor] = useState<WarmupSenderRow | null>(null)

  if (isLoading || !data) return <SettingsEmpty>Loading…</SettingsEmpty>
  if (!data.offered) return <Notice>Inbox warmup isn't available on this workspace.</Notice>
  const warming = data.senders.filter((s) => s.warmup && s.warmup.state !== 'failed').length

  return (
    <div className="flex flex-col gap-4">
      {data.stopped && <Notice level="error" title="MagpieCRM has stopped warmup for this workspace">{data.stopped}</Notice>}
      {data.error && <Notice level="error" title="The warmup service couldn't be reached">{data.error}</Notice>}
      <SettingsPanel>
        <SettingsBlock title="How it works">
          <p className="text-sm leading-relaxed text-muted-foreground">
            A new sender that suddenly emails hundreds of strangers looks like a spammer to Gmail and Outlook. Warmup gives each sender a steady, growing
            stream of ordinary email with a pool of other real inboxes, which open it, reply to some of it and move it out of spam. It's sent through
            our mail server, the same way as your campaigns, starting at about 10 a day and rising to about 40.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The warmup that arrives in your inbox is filed in a folder called Warmbly and deleted after 30 days. Keep warmup running alongside your
            campaigns. It helps, but it can't promise your email reaches the inbox: what you send, and who to, matters most.
          </p>
        </SettingsBlock>

        <SettingsBlock
          title="Senders"
          description={`Up to ${data.maxSenders} senders can warm at once. Each needs its own inbox connected under Reply detection, and SPF and DMARC records on its domain.`}
        >
          {data.senders.length === 0 ? (
            <SettingsEmpty>Add a sender address first (Settings → Sender addresses).</SettingsEmpty>
          ) : (
            <SettingsList>
              {data.senders.map((s) => (
                <SenderWarmup key={s.senderId} row={s} full={warming >= data.maxSenders} stopped={Boolean(data.stopped)} onStart={() => setConsentFor(s)} />
              ))}
            </SettingsList>
          )}
        </SettingsBlock>

        {warming > 0 && <Placement />}
      </SettingsPanel>

      {consentFor && <Consent row={consentFor} consent={data.consent} onClose={() => setConsentFor(null)} />}
    </div>
  )
}

function SenderWarmup({ row, full, stopped, onStart }: { row: WarmupSenderRow; full: boolean; stopped: boolean; onStart: () => void }) {
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
          <Button size="sm" onClick={onStart} disabled={row.blockers.length > 0 || full || stopped} title={full ? 'As many senders as can warm at once are warming.' : undefined}>
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
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {row.blockers.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
        )}
        {w?.state === 'failed' && w.reason && <Notice level="error">{w.reason}</Notice>}
        {w?.state === 'starting' && <p className="text-xs text-muted-foreground">Starting: the first warmup goes out within a few minutes, during the working day.</p>}
        {w?.state === 'paused' && w.pausedBy === 'us' && w.reason && <Notice level="warning" title="Paused by MagpieCRM">{w.reason}</Notice>}
        {on && w.health && HEALTH[w.health.state] && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={HEALTH[w.health.state].variant}>{HEALTH[w.health.state].label}</Badge>
            <span>
              {HEALTH[w.health.state].about || 'Its warmup is landing well.'}
              {w.health.until ? ` Until ${new Date(w.health.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.` : ''}
            </span>
          </div>
        )}
        {on && w.week && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Last 7 days: {w.week.sent} sent · {w.week.replied} replied · {w.week.spam} found in spam
          </p>
        )}
        {on && w.partners !== null && (
          <p className="text-xs text-muted-foreground">The pool has {w.partners} partners for it today, so it sends fewer than its target.</p>
        )}
        {on && w.problem && <Notice level="error" title="Its warmup isn't sending">{w.problem}</Notice>}
        {failed && <Notice level="error">{failed.message}</Notice>}
        {on && (
          <SettingsActions>
            {confirming ? (
              <>
                <span className="text-xs text-muted-foreground">Stop warmup and take this inbox's login out of the pool?</span>
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
                <p className="text-xs text-muted-foreground tabular-nums">Google, Microsoft and Yahoo: {landed(s.major, 20)}</p>
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
