import { useQuery } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getUsageFn } from '../../../server/functions'
import { SETTINGS_SECTIONS, type SettingsSection } from '../sections'
import type { SectionStatus, StatusLevel } from '../useSettingsStatus'
import { AllowanceMeter } from './AllowanceMeter'
import { SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel } from './SettingsBlock'

const ORDER: Record<StatusLevel, number> = { error: 0, warning: 1, ok: 2, info: 3 }

function StatusIcon({ level }: { level: StatusLevel }) {
  const className = 'h-4 w-4 shrink-0'
  if (level === 'error') return <AlertCircle className={`${className} text-destructive`} />
  if (level === 'warning') return <AlertTriangle className={`${className} text-amber-600 dark:text-amber-400`} />
  if (level === 'ok') return <CheckCircle2 className={`${className} text-emerald-600 dark:text-emerald-400`} />
  return <Info className={`${className} text-muted-foreground`} />
}

const USAGE_TILES = [
  { key: 'prospects', label: 'Prospects found' },
  { key: 'emailLookups', label: 'Email lookups' },
  { key: 'contactsSaved', label: 'Contacts saved' },
  { key: 'emailsSent', label: 'Emails sent' },
] as const

/** This month's usage, counted by the app itself (see server/usage.ts). */
function UsageThisMonth({ data }: { data: Awaited<ReturnType<typeof getUsageFn>> }) {
  const monthName = new Date(`${data.month}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
  return (
    <SettingsBlock title="Usage this month" description={`${monthName} so far.`}>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md-s border border-border bg-border">
        {USAGE_TILES.map((tile) => (
          <div key={tile.key} className="bg-background px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{data[tile.key].toLocaleString()}</p>
          </div>
        ))}
      </div>
    </SettingsBlock>
  )
}

const TINT: Record<StatusLevel, string> = {
  error: 'border-destructive/40 bg-destructive/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  ok: 'border-border bg-background hover:bg-muted',
  info: 'border-border bg-background hover:bg-muted',
}

/**
 * Settings → Overview: the plan's allowances, this month's usage, then every
 * other page's status as rows, problems first.
 */
export function SettingsOverview({
  statuses,
  isLoading,
  onOpen,
}: {
  statuses: Partial<Record<SettingsSection, SectionStatus>>
  isLoading: boolean
  onOpen: (section: SettingsSection) => void
}) {
  const { data: usage } = useQuery({ queryKey: queryKeys.settings.usage(), queryFn: () => getUsageFn() })
  const rows = SETTINGS_SECTIONS.flatMap((section) => {
    const status = statuses[section.id]
    return status ? [{ section, status }] : []
  }).sort((a, b) => ORDER[a.status.level] - ORDER[b.status.level])

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SettingsPanel>
          <SettingsBlock title="Setup">
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              Checking your setup…
            </SettingsEmpty>
          </SettingsBlock>
        </SettingsPanel>
      </div>
    )
  }

  const problems = rows.filter((r) => r.status.level === 'error' || r.status.level === 'warning').length
  const hasPlan = Boolean(usage?.allowance?.items.length)

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanel>
        {hasPlan && (
          <SettingsBlock title="Your plan" description="What your plan gives you each month, and how much of it you've used.">
            <AllowanceMeter heading={false} />
          </SettingsBlock>
        )}
        {usage && <UsageThisMonth data={usage} />}

        <SettingsBlock
          title="Setup"
          description={problems === 0 ? 'Everything is set up.' : `${problems} ${problems === 1 ? 'thing needs' : 'things need'} your attention.`}
        >
          <SettingsList>
            {rows.map(({ section, status }) => (
              <button
                key={section.id}
                type="button"
                onClick={() => onOpen(section.id)}
                className={`group flex w-full min-h-[46px] items-center gap-3 rounded-md-s border px-3 py-1.5 text-left transition-colors cursor-pointer ${TINT[status.level]}`}
              >
                <StatusIcon level={status.level} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{section.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{status.text}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground group-hover:text-accent">
                  {status.action ?? 'Open'} <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </SettingsList>
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}
