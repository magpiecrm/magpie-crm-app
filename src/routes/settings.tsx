import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '../features/settings/components/SettingsPage'
import { parseSettingsSection, type SettingsSection } from '../features/settings/sections'

export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsSection; checkout?: string } => {
    const tab = parseSettingsSection(search.tab)
    // Back from paying for a plan (Plan and billing).
    const checkout = typeof search.checkout === 'string' && /^cs_[A-Za-z0-9_]{1,200}$/.test(search.checkout) ? search.checkout : undefined
    return { ...(tab ? { tab } : {}), ...(checkout ? { checkout } : {}) }
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const { tab, checkout } = Route.useSearch()
  return <SettingsPage initialSection={tab} checkoutSession={checkout} />
}
