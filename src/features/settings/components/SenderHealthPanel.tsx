import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, Activity } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { queryKeys } from '../../../queryKeys'
import { checkSenderHealthFn, senderHealthFn } from '../../../server/functions'
import { SettingsBlock } from './SettingsBlock'

type Report = NonNullable<Awaited<ReturnType<typeof senderHealthFn>>>
type Level = Report['level']
type Issue = Report['issues'][number]

const LEVEL_BADGE: Record<Level, { variant: 'success' | 'warning' | 'error' | 'default'; label: string }> = {
  ok: { variant: 'success', label: 'Healthy' },
  warning: { variant: 'warning', label: 'Needs attention' },
  critical: { variant: 'error', label: 'Replace or fix' },
  unknown: { variant: 'default', label: "Couldn't check" },
}

function IssueRow({ issue }: { issue: Issue }) {
  const Icon = issue.level === 'critical' ? AlertCircle : issue.level === 'warning' ? AlertTriangle : HelpCircle
  const tone =
    issue.level === 'critical' ? 'text-destructive' : issue.level === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${tone}`} />
      <span className="min-w-0">
        <span className="text-foreground">{issue.message}</span>
        {issue.fix && <span className="block text-muted-foreground mt-0.5 break-words">{issue.fix}</span>}
      </span>
    </li>
  )
}

function Lists({ listedOn, unchecked, total }: { listedOn: string[]; unchecked: string[]; total: number }) {
  const clean = total - listedOn.length - unchecked.length
  return (
    <p className="text-[11px] text-muted-foreground">
      {listedOn.length > 0 ? (
        <span className="text-destructive font-semibold">Listed on {listedOn.join(', ')}. </span>
      ) : null}
      {clean > 0 && `Clean on ${clean} ${clean === 1 ? 'blocklist' : 'blocklists'}. `}
      {unchecked.length > 0 && `Couldn't check ${unchecked.join(', ')}.`}
    </p>
  )
}

/**
 * Blocklist, reverse DNS and SPF status of the IPs and FROM domain Reacher
 * verifies from. Checked every six hours in the background; a new listing
 * also raises a notification.
 */
export function SenderHealthPanel({
  listedDomainOverride,
  onOverrideChange,
}: {
  /** The blocklisted FROM domain the user chose to keep verifying with. */
  listedDomainOverride: string | null
  onOverrideChange: (domain: string | null) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState('')
  const { data: report, isLoading } = useQuery({
    queryKey: queryKeys.prospects.senderHealth(),
    queryFn: () => senderHealthFn(),
  })

  const checkNow = async () => {
    setIsChecking(true)
    setError('')
    try {
      const next = await checkSenderHealthFn()
      if (!next) setError('Reacher isn’t in use, so there’s nothing to check. Save your settings first.')
      queryClient.setQueryData(queryKeys.prospects.senderHealth(), next)
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() })
    } catch (e: any) {
      setError(e?.message || 'Check failed')
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <SettingsBlock
      title="Verification IP & domain health"
      description={
      <p>
        Mail servers only answer checks from IPs and sender domains they trust. This checks each verifying IP against the
        main blocklists (Spamhaus, Barracuda, SpamCop and two smaller ones), its reverse DNS, and the FROM domain's SPF.
        It runs every six hours; a new listing sends a notification so you know to swap the IP out.
      </p>
      }
    >

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={checkNow}
          disabled={isChecking}
          className="py-2 px-3 border border-border bg-card hover:bg-muted disabled:opacity-50 text-sm font-semibold rounded-md-s inline-flex items-center gap-2 cursor-pointer"
        >
          {isChecking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          {isChecking ? 'Checking…' : 'Check now'}
        </button>
        {report && (
          <span className="text-xs text-muted-foreground">
            Last checked {new Date(report.checked_at).toLocaleString()}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!isLoading && !report && !error && (
        <p className="text-xs text-muted-foreground">Not checked yet. The first check runs a minute after the app starts.</p>
      )}

      {report && (
        <div className="border border-border divide-y divide-border">
          {report.ips.map((ip) => (
            <div key={`${ip.label}-${ip.host}`} className="px-3 py-2.5 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{ip.label}</span>
                <span className="text-xs text-muted-foreground font-mono">{ip.ip ?? ip.host}</span>
                <Badge variant={LEVEL_BADGE[ip.level].variant}>{LEVEL_BADGE[ip.level].label}</Badge>
              </div>
              {ip.ip && (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Reverse DNS: <span className="font-mono">{ip.ptr ?? 'none'}</span>
                  </p>
                  <Lists listedOn={ip.listedOn} unchecked={ip.unchecked} total={5} />
                </>
              )}
              {ip.issues.length > 0 && (
                <ul className="flex flex-col gap-1.5 mt-0.5">
                  {ip.issues.map((issue) => (
                    <IssueRow key={issue.code} issue={issue} />
                  ))}
                </ul>
              )}
            </div>
          ))}

          {report.domain && (
            <div className="px-3 py-2.5 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-foreground">FROM domain</span>
                <span className="text-xs text-muted-foreground font-mono">{report.domain.domain}</span>
                <Badge variant={LEVEL_BADGE[report.domain.level].variant}>{LEVEL_BADGE[report.domain.level].label}</Badge>
              </div>
              <Lists listedOn={report.domain.listedOn} unchecked={report.domain.unchecked} total={1} />
              {report.domain.issues.length > 0 && (
                <ul className="flex flex-col gap-1.5 mt-0.5">
                  {report.domain.issues.map((issue) => (
                    <IssueRow key={issue.code} issue={issue} />
                  ))}
                </ul>
              )}
              {report.domain.listedOn.length > 0 && (
                <label className="flex items-start gap-2 mt-1 text-xs text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-border text-accent focus:ring-accent"
                    checked={listedDomainOverride === report.domain.domain}
                    onChange={(e) => onOverrideChange(e.target.checked ? report.domain!.domain : null)}
                  />
                  <span>
                    <span className="font-semibold">Keep verifying anyway (testing)</span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">
                      Verification is paused while this domain is listed. Tick this to keep testing with it until your
                      replacement domain is ready; some mail servers will refuse checks that name it.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          {report.issues.length > 0 && (
            <div className="px-3 py-2.5 flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-foreground">Reacher setup</span>
              <ul className="flex flex-col gap-1.5">
                {report.issues.map((issue) => (
                  <IssueRow key={issue.code} issue={issue} />
                ))}
              </ul>
            </div>
          )}

          {report.level === 'ok' && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" /> Everything checks out.
            </div>
          )}
        </div>
      )}
    </SettingsBlock>
  )
}
