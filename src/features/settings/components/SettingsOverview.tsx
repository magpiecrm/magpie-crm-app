import { useQuery } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getUsageFn } from '../../../server/functions'
import { SETTINGS_SECTIONS, type SettingsSection } from '../sections'
import type { SectionStatus, StatusLevel } from '../useSettingsStatus'

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

/** This month's usage, counted by the app itself (see server/usage.ts). */
function UsageThisMonth() {
  const { data } = useQuery({ queryKey: queryKeys.settings.usage(), queryFn: () => getUsageFn() })
  if (!data) return null
  const monthName = new Date(`${data.month}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Usage in {monthName}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border border-border">
        {USAGE_TILES.map((tile) => (
          <div key={tile.key} className="bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="text-xl font-semibold tabular-nums text-foreground">{data[tile.key].toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Settings → Overview: this month's usage, then every page with a status, problems first. */
export function SettingsOverview({
  statuses,
  isLoading,
  onOpen,
}: {
  statuses: Partial<Record<SettingsSection, SectionStatus>>
  isLoading: boolean
  onOpen: (section: SettingsSection) => void
}) {
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

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <UsageThisMonth />
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">
          {problems === 0 ? 'Everything is set up.' : `${problems} ${problems === 1 ? 'thing needs' : 'things need'} your attention.`}
        </p>
        <div className="border border-border divide-y divide-border bg-card">
          {rows.map(({ section, status }) => (
            <div key={section.id} className="flex items-center gap-3 px-4 py-3">
              <StatusIcon level={status.level} className="w-5 h-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {section.label}
                  {section.group && <span className="ml-2 text-xs font-normal text-muted-foreground">{section.group}</span>}
                </p>
                <p className="text-xs text-muted-foreground">{status.text}</p>
              </div>
              <button
                type="button"
                onClick={() => onOpen(section.id)}
                className={`shrink-0 py-1.5 px-3 text-xs font-semibold rounded-md-s cursor-pointer border ${
                  status.action ? 'border-border bg-card hover:bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {status.action ?? 'Open'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
