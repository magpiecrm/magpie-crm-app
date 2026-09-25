import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '../features/copilot/components/SettingsPage'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})
