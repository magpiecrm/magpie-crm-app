import { useQuery } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, CircleDashed, PlusCircle, RefreshCw } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getUsageFn } from '../../../server/functions'
import { SETTINGS_SECTIONS, type SettingsSection } from '../sections'
import type { SectionStatus, StatusLevel } from '../useSettingsStatus'
import { AllowanceMeter } from './AllowanceMeter'
import { SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel } from './SettingsBlock'


/** What a setup row is, so each icon means one thing: a problem, unfinished, done, or an add-on to buy. */
type RowKind = 'error' | 'warning' | 'unfinished' | 'done' | 'addon'
function kindOf(status: SectionStatus): RowKind {
  if (status.level === 'error' || status.level === 'warning') return status.level
  if (status.level === 'info' && status.action === 'Add') return 'addon'
  if (status.level === 'info' && status.action) return 'unfinished'
  return 'done'
}
const KIND_ORDER: Record<RowKind, number> = { error: 0, warning: 1, unfinished: 2, done: 3, addon: 4 }

function StatusIcon({ kind }: { kind: RowKind }) {
  const className = 'h-4 w-4 shrink-0'
  if (kind === 'error') return <AlertCircle className={`${className} text-destructive`} aria-label="Needs fixing" />
  if (kind === 'warning') return <AlertTriangle className={`${className} text-amber-600 dark:text-amber-400`} aria-label="Needs attention" />
  if (kind === 'unfinished') return <CircleDashed className={`${className} text-amber-600 dark:text-amber-400`} aria-label="Not set up yet" />
  if (kind === 'addon') return <PlusCircle className={`${className} text-muted-foreground`} aria-label="Add-on" />
  return <CheckCircle2 className={`${className} text-emerald-600 dark:text-emerald-400`} aria-label="Done" />
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
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {USAGE_TILES.map((tile) => (
          <div key={tile.key} className="flex flex-col gap-0.5">
            <p className="text-[13px] text-muted-foreground">{tile.label}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{data[tile.key].toLocaleString()}</p>
          </div>
        ))}
      </div>
    </SettingsBlock>
  )
}

const TINT: Record<StatusLevel, string> = {
  error: 'bg-destructive/[0.06] hover:bg-destructive/10',
  warning: 'bg-amber-500/[0.08] hover:bg-amber-500/[0.12]',
  ok: 'hover:bg-muted',
  info: 'hover:bg-muted',
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
  }).sort((a, b) => KIND_ORDER[kindOf(a.status)] - KIND_ORDER[kindOf(b.status)])

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

  const todo = rows.filter((r) => kindOf(r.status) !== 'done' && kindOf(r.status) !== 'addon')
  const fine = rows.filter((r) => kindOf(r.status) === 'done' || kindOf(r.status) === 'addon')
  const row = ({ section, status }: (typeof rows)[number]) => (
    <button
      key={section.id}
      type="button"
      onClick={() => onOpen(section.id)}
      className={`group flex w-full min-h-[48px] items-center gap-3 px-3.5 py-2 text-left transition-colors cursor-pointer ${TINT[status.level]}`}
    >
      <StatusIcon kind={kindOf(status)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{section.label}</span>
        <span className="block text-[13px] text-muted-foreground">{status.text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground group-hover:text-accent">
        {status.action ?? 'Open'} <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </button>
  )
  const problems = rows.filter((r) => r.status.level === 'error' || r.status.level === 'warning').length
  const unfinished = rows.filter((r) => kindOf(r.status) === 'unfinished').length
  const hasPlan = Boolean(usage?.allowance?.items.length)

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanel>
        {hasPlan && (
          <SettingsBlock title="Your plan" description="What your plan gives you each month, and how much of it you have left.">
            <AllowanceMeter heading={false} />
          </SettingsBlock>
        )}
        {usage && <UsageThisMonth data={usage} />}

        <SettingsBlock
          title="Setup"
          description={
            problems === 0 && unfinished === 0
              ? 'Everything is set up.'
              : [
                  problems > 0 && `${problems} ${problems === 1 ? 'thing needs' : 'things need'} your attention`,
                  unfinished > 0 && `${unfinished} ${unfinished === 1 ? 'is' : 'are'} still to set up`,
                ]
                  .filter(Boolean)
                  .join(', ') + '.'
          }
        >
          {todo.length > 0 && <SettingsList>{todo.map(row)}</SettingsList>}
          {/* What's set up folds away, so what needs doing is all there is to read. */}
          {fine.length > 0 && (
            <details className="group" open={todo.length === 0}>
              <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md-xs text-[13px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                {fine.length} {fine.length === 1 ? 'area' : 'areas'} set up
              </summary>
              <SettingsList className="mt-2">{fine.map(row)}</SettingsList>
            </details>
          )}
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}
