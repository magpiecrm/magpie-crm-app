import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '../features/settings/components/SettingsPage'
import { parseSettingsSection, type SettingsSection } from '../features/settings/sections'

export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsSection } => {
    const tab = parseSettingsSection(search.tab)
    return tab ? { tab } : {}
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const { tab } = Route.useSearch()
  return <SettingsPage initialSection={tab} />
}
