import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertCircle, AlertTriangle, AtSign, HelpCircle, Server, Wrench } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { checkSenderHealthFn, senderHealthFn } from '../../../server/functions'
import { SettingsActions, SettingsBlock, SettingsCheck, SettingsEmpty, SettingsList, SettingsRow } from './SettingsBlock'

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
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className="min-w-0">
        <span className="text-foreground">{issue.message}</span>
        {issue.fix && <span className="block break-words text-muted-foreground">{issue.fix}</span>}
      </span>
    </li>
  )
}

function Issues({ issues }: { issues: Issue[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {issues.map((issue) => (
        <IssueRow key={issue.code} issue={issue} />
      ))}
    </ul>
  )
}

function Lists({ listedOn, unchecked, total }: { listedOn: string[]; unchecked: string[]; total: number }) {
  const clean = total - listedOn.length - unchecked.length
  return (
    <p className="text-xs text-muted-foreground">
      {listedOn.length > 0 ? (
        <span className="font-semibold text-destructive">Listed on {listedOn.join(', ')}. </span>
      ) : null}
      {clean > 0 && `Clean on ${clean} ${clean === 1 ? 'blocklist' : 'blocklists'}. `}
      {unchecked.length > 0 && `Couldn't check ${unchecked.join(', ')}.`}
    </p>
  )
}

/**
 * Blocklist, reverse DNS and SPF status of the IPs and FROM domain the verification server
 * verifies from. Checked every six hours in the background; a new listing
 * also raises a notification. A block of the Email verification page's panel.
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
      if (!next) setError('The verification server isn’t in use, so there’s nothing to check. Save your settings first.')
      queryClient.setQueryData(queryKeys.prospects.senderHealth(), next)
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() })
    } catch (e: any) {
      setError(e?.message || 'Check failed')
    } finally {
      setIsChecking(false)
    }
  }

  const domain = report?.domain

  return (
    <SettingsBlock
      title="IP and domain health"
      description={
        <>
          <p>
            Mail servers only answer checks from IPs and sender domains they trust. This checks each verifying IP against the
            main blocklists (Spamhaus, Barracuda, SpamCop and two smaller ones), its reverse DNS, and the FROM domain's SPF.
          </p>
          <p>It runs every six hours; a new listing sends a notification so you know to swap the IP out.</p>
        </>
      }
    >
      {error && <Notice level="error">{error}</Notice>}
      {!isLoading && !report && !error && <SettingsEmpty>Not checked yet. The first check runs a minute after the app starts.</SettingsEmpty>}

      {report && (
        <SettingsList>
          {report.ips.map((ip) => (
            <SettingsRow
              key={`${ip.label}-${ip.host}`}
              icon={<Server className="h-4 w-4" />}
              title={ip.label}
              detail={<span className="font-mono">{ip.ip ?? ip.host}</span>}
              badge={<Badge variant={LEVEL_BADGE[ip.level].variant}>{LEVEL_BADGE[ip.level].label}</Badge>}
            >
              {(ip.ip || ip.issues.length > 0) && (
                <div className="flex flex-col gap-1.5">
                  {ip.ip && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Reverse DNS: <span className="font-mono">{ip.ptr ?? 'none'}</span>
                      </p>
                      <Lists listedOn={ip.listedOn} unchecked={ip.unchecked} total={5} />
                    </>
                  )}
                  {ip.issues.length > 0 && <Issues issues={ip.issues} />}
                </div>
              )}
            </SettingsRow>
          ))}

          {domain && (
            <SettingsRow
              icon={<AtSign className="h-4 w-4" />}
              title="FROM domain"
              detail={<span className="font-mono">{domain.domain}</span>}
              badge={<Badge variant={LEVEL_BADGE[domain.level].variant}>{LEVEL_BADGE[domain.level].label}</Badge>}
            >
              <div className="flex flex-col gap-1.5">
                <Lists listedOn={domain.listedOn} unchecked={domain.unchecked} total={1} />
                {domain.issues.length > 0 && <Issues issues={domain.issues} />}
                {domain.listedOn.length > 0 && (
                  <SettingsCheck
                    checked={listedDomainOverride === domain.domain}
                    onChange={(checked) => onOverrideChange(checked ? domain.domain : null)}
                    label="Keep verifying anyway (testing)"
                    hint="Verification is paused while this domain is listed. Tick this to keep testing with it until your replacement domain is ready; some mail servers will refuse checks that name it."
                  />
                )}
              </div>
            </SettingsRow>
          )}

          {report.issues.length > 0 && (
            <SettingsRow icon={<Wrench className="h-4 w-4" />} title="Verification server setup">
              <Issues issues={report.issues} />
            </SettingsRow>
          )}
        </SettingsList>
      )}

      {report?.level === 'ok' && <Notice level="success">Everything checks out.</Notice>}

      <SettingsActions>
        {/* type="button": this block sits inside the Email verification page's form. */}
        <Button type="button" onClick={checkNow} isLoading={isChecking} leftIcon={<Activity className="h-4 w-4" />}>
          Check now
        </Button>
        {report && <span className="text-xs text-muted-foreground">Last checked {new Date(report.checked_at).toLocaleString()}</span>}
      </SettingsActions>
    </SettingsBlock>
  )
}
