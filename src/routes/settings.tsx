import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage, isSettingsTab, type SettingsTab } from '../features/copilot/components/SettingsPage'

export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } =>
    isSettingsTab(search.tab) ? { tab: search.tab } : {},
  component: SettingsRoute,
})

function SettingsRoute() {
  const { tab } = Route.useSearch()
  return <SettingsPage initialTab={tab} />
}
