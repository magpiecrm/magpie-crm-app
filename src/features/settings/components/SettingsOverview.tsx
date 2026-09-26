import { AlertCircle, AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { SETTINGS_SECTIONS, type SettingsSection } from '../sections'
import type { SectionStatus, StatusLevel } from '../useSettingsStatus'

const ORDER: Record<StatusLevel, number> = { error: 0, warning: 1, ok: 2, info: 3 }

function StatusIcon({ level, className = 'w-4 h-4' }: { level: StatusLevel; className?: string }) {
  if (level === 'error') return <AlertCircle className={`${className} text-destructive`} />
  if (level === 'warning') return <AlertTriangle className={`${className} text-amber-600 dark:text-amber-400`} />
  if (level === 'ok') return <CheckCircle2 className={`${className} text-emerald-600 dark:text-emerald-400`} />
  return <Info className={`${className} text-muted-foreground`} />
}

/** Settings → Overview: every page with a status, problems first, each with a way in. */
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
    <div className="flex flex-col gap-3 max-w-3xl">
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
  )
}
