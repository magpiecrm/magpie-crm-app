import { useQuery } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getUsageFn } from '../../../server/functions'
import { SETTINGS_SECTIONS, type SettingsSection } from '../sections'
import type { SectionStatus, StatusLevel } from '../useSettingsStatus'
import { AllowanceMeter } from './AllowanceMeter'

const ORDER: Record<StatusLevel, number> = { error: 0, warning: 1, ok: 2, info: 3 }

function StatusIcon({ level, className = 'w-4 h-4' }: { level: StatusLevel; className?: string }) {
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

const CARD = 'border border-border bg-card rounded-md-s'
const HEADING = 'text-xs font-bold text-muted-foreground uppercase tracking-wider'

/** This month's usage, counted by the app itself (see server/usage.ts). */
function UsageThisMonth({ data, wide }: { data: Awaited<ReturnType<typeof getUsageFn>>; wide: boolean }) {
  const monthName = new Date(`${data.month}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <h3 className={HEADING}>Usage in {monthName}</h3>
      <div className={`grid grid-cols-2 gap-px bg-border overflow-hidden ${wide ? 'sm:grid-cols-4' : ''} ${CARD}`}>
        {USAGE_TILES.map((tile) => (
          <div key={tile.key} className="bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{data[tile.key].toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const TINT: Record<StatusLevel, string> = {
  error: 'border-destructive/40 bg-destructive/5 hover:bg-destructive/10',
  warning: 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10',
  ok: 'border-border bg-card hover:bg-muted/60',
  info: 'border-border bg-card hover:bg-muted/60',
}

/**
 * Settings → Overview: the plan's allowances beside this month's usage, then
 * every page's status as cards, problems first.
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
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <RefreshCw className="w-4 h-4 animate-spin text-accent" /> Checking your setup…
      </div>
    )
  }

  const problems = rows.filter((r) => r.status.level === 'error' || r.status.level === 'warning').length
  const hasPlan = Boolean(usage?.allowance?.items.length)

  return (
    <div className="flex flex-col gap-8">
      {usage && (
        <div className={`grid gap-6 items-start ${hasPlan ? 'lg:grid-cols-2' : ''}`}>
          {hasPlan && (
            <div className={`p-4 ${CARD}`}>
              <AllowanceMeter />
            </div>
          )}
          <UsageThisMonth data={usage} wide={!hasPlan} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={HEADING}>Setup</h3>
          <span className={`text-xs font-semibold ${problems ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {problems === 0 ? 'Everything is set up' : `${problems} ${problems === 1 ? 'thing needs' : 'things need'} your attention`}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ section, status }) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onOpen(section.id)}
              className={`group text-left flex flex-col gap-2 p-4 rounded-md-s border transition-colors cursor-pointer ${TINT[status.level]}`}
            >
              <span className="flex items-center gap-2">
                <StatusIcon level={status.level} className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold text-foreground truncate">{section.label}</span>
                {section.group && <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{section.group}</span>}
              </span>
              <span className="text-xs text-muted-foreground leading-snug flex-1">{status.text}</span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground group-hover:text-accent">
                {status.action ?? 'Open'} <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
