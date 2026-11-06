import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { SETTINGS_SECTIONS, type SettingsSection } from '../sections'
import { useSettingsStatus, type StatusLevel } from '../useSettingsStatus'
import { SettingsOverview } from './SettingsOverview'
import { ProspectingTab } from './ProspectingTab'
import { ProspectSearchTab } from './ProspectSearchTab'
import { EmailSendingTab } from './EmailSendingTab'
import { SendersTab } from './SendersTab'
import { RepliesTab } from './RepliesTab'
import { WarmupTab } from './WarmupTab'
import { CopilotTab } from './CopilotTab'
import { McpTab } from './McpTab'
import { TeamTab } from './TeamTab'
import { ContactFieldsTab } from './ContactFieldsTab'
import { ApiKeysTab } from './ApiKeysTab'
import { PipelineSettings } from '../../sales/components/PipelineSettings'
import { BillingTab } from './BillingTab'
import { Select } from '../../../components/ui/Select'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'

const DOT: Record<StatusLevel, string> = {
  error: 'bg-destructive',
  warning: 'bg-amber-500',
  ok: 'bg-emerald-500',
  info: '',
}

type Section = (typeof SETTINGS_SECTIONS)[number]

/** Copilot's intro where the host runs the copilot (COPILOT_MANAGED): there are no keys to add. */
const COPILOT_MANAGED_INTRO = "The in-app copilot, and how much of this month's AI budget it has used."

/** Pages a managed copy (PROSPECTING_MANAGED) doesn't show: its host runs them. */
const MANAGED_HIDDEN = new Set<SettingsSection>(['source', 'verification'])

/** Menu groups in order, each with its pages. */
function groupsOf(sections: readonly Section[]) {
  return sections.reduce<Array<{ name: string | null; sections: Section[] }>>((groups, section) => {
    const last = groups[groups.length - 1]
    if (last && last.name === section.group) last.sections.push(section)
    else groups.push({ name: section.group, sections: [section] })
    return groups
  }, [])
}

/**
 * Settings: a grouped menu of pages (a dropdown on narrow screens), each
 * opening with a line on what it's for. Status dots and the Overview show
 * what's set up and what needs attention.
 */
export function SettingsPage({ initialSection, checkoutSession }: { initialSection?: SettingsSection; checkoutSession?: string }) {
  const [active, setActive] = useState<SettingsSection>(initialSection ?? 'overview')
  const queryClient = useQueryClient()
  const { statuses, isLoading, managed, billingManaged, warmupShown, copilotManaged } = useSettingsStatus()
  // Plan and billing only when the host bills for this workspace; Warmup only where the host offers it, or it can be added to the plan.
  const visible = SETTINGS_SECTIONS.filter(
    (s) => !(managed && MANAGED_HIDDEN.has(s.id)) && (s.id !== 'billing' || billingManaged) && (s.id !== 'warmup' || warmupShown),
  )
  const GROUPS = groupsOf(visible)
  const hiddenPage = managed && MANAGED_HIDDEN.has(active)

  // Deep links (e.g. the sidebar's "add your key") can land here while the
  // page is already mounted.
  useEffect(() => {
    if (initialSection) setActive(initialSection)
  }, [initialSection])

  const open = (section: SettingsSection) => {
    setActive(section)
    // A page may have just fixed something, so the dots and Overview re-check.
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.email.senders() })
  }

  const current = SETTINGS_SECTIONS.find((s) => s.id === active) ?? SETTINGS_SECTIONS[0]
  const currentStatus = statuses[current.id]

  return (
    // Centred once the window is wider than the menu and a full-width page together.
    <div className="p-4 lg:p-8 flex flex-col gap-6 w-full max-w-[84rem] mx-auto">
      <h1 className="lg:hidden text-sm font-semibold text-muted-foreground">Settings</h1>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        {/* Narrow screens: one dropdown instead of a menu column. */}
        <label className="lg:hidden flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Page</span>
          <Select
            value={active}
            onChange={(e) => open(e.target.value as SettingsSection)}
            className={INPUT_CLASS}
          >
            {GROUPS.map((group) =>
              group.name ? (
                <optgroup key={group.name} label={group.name}>
                  {group.sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </optgroup>
              ) : (
                group.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)
              ),
            )}
          </Select>
        </label>

        {/* Wide screens: the title and menu stay where they start while the page scrolls. */}
        <aside className="hidden lg:flex flex-col gap-3 w-52 shrink-0 sticky top-24 self-start max-h-[calc(100dvh-7rem)] overflow-y-auto">
        <h1 className="px-3 pt-1 text-base font-semibold text-foreground">Settings</h1>
        <nav aria-label="Settings" className="flex flex-col gap-4">
          {GROUPS.map((group) => (
            <div key={group.name ?? 'top'} className="flex flex-col gap-0.5">
              {group.name && (
                <span className="px-3 pb-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{group.name}</span>
              )}
              {group.sections.map((s) => {
                const level = statuses[s.id]?.level
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => open(s.id)}
                    aria-current={active === s.id ? 'page' : undefined}
                    className={`flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left rounded-md-s cursor-pointer transition-colors ${
                      active === s.id ? 'bg-accent/10 text-accent font-semibold' : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <span className="truncate">{s.label}</span>
                    {/* Only what needs attention: a dot on every page that's fine is noise. */}
                    {(level === 'warning' || level === 'error') && (
                      <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[level]}`} title={statuses[s.id]?.text} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        </aside>

        {/* Every page is the same width: at its widest the panel's label column, its controls column and their padding (SettingsBlock). */}
        <section className="flex-1 min-w-0 max-w-[65.5rem] flex flex-col gap-5">
          <header className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h2 className="text-2xl font-display text-foreground">{current.label}</h2>
              {/* The same status the menu's dot stands for, in words, beside the page it's about. */}
              {active !== 'overview' && currentStatus && (
                <span className="inline-flex min-w-0 max-w-full items-start gap-1.5 rounded-[14px] border border-border bg-card px-2.5 py-1 text-xs leading-[18px] text-foreground">
                  <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${DOT[currentStatus.level] || 'bg-muted-foreground/60'}`} />
                  <span className="min-w-0">{currentStatus.text.replace(/\.$/, '')}</span>
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">{copilotManaged && current.id === 'copilot' ? COPILOT_MANAGED_INTRO : current.intro}</p>
          </header>

          {active === 'overview' && <SettingsOverview statuses={statuses} isLoading={isLoading} onOpen={open} />}
          {hiddenPage && (
            <Notice>Prospect data and email verification are provided with your plan, so there's nothing to set up here.</Notice>
          )}
          {active === 'search' && <ProspectSearchTab />}
          {active === 'source' && !hiddenPage && <ProspectingTab key="source" section="source" />}
          {active === 'verification' && !hiddenPage && <ProspectingTab key="verification" section="verification" />}
          {active === 'sending' && <EmailSendingTab />}
          {active === 'senders' && <SendersTab />}
          {active === 'replies' && <RepliesTab />}
          {active === 'warmup' && <WarmupTab onOpen={open} />}
          {active === 'pipelines' && <PipelineSettings />}
          {active === 'copilot' && <CopilotTab />}
          {active === 'mcp' && <McpTab />}
          {active === 'billing' && billingManaged && <BillingTab checkoutSession={checkoutSession} />}
          {active === 'team' && <TeamTab />}
          {active === 'fields' && <ContactFieldsTab />}
          {active === 'api' && <ApiKeysTab />}
        </section>
      </div>
    </div>
  )
}
