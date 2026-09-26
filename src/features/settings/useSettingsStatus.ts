import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { getCopilotSettingsFn, getEmailSettingsFn, getSendersFn, getUsersFn, prospectingStatusFn } from '../../server/functions'
import type { SettingsSection } from './sections'

export type StatusLevel = 'ok' | 'warning' | 'error' | 'info'

export interface SectionStatus {
  level: StatusLevel
  /** One line: what's set up, or what's wrong. */
  text: string
  /** Button label when there's something to do. */
  action?: string
}

/**
 * Where each settings page stands, for the menu's status dots and the
 * Overview. Pages without a status (e.g. Contact fields) are left out.
 */
export function useSettingsStatus(): {
  statuses: Partial<Record<SettingsSection, SectionStatus>>
  isLoading: boolean
  /** PROSPECTING_MANAGED: Data source and Email verification are the host's, so they're hidden. */
  managed: boolean
} {
  const prospecting = useQuery({ queryKey: queryKeys.prospects.status(), queryFn: () => prospectingStatusFn() })
  const copilot = useQuery({ queryKey: queryKeys.settings.copilot(), queryFn: () => getCopilotSettingsFn() })
  const sending = useQuery({ queryKey: queryKeys.settings.sending(), queryFn: () => getEmailSettingsFn() })
  const senders = useQuery({ queryKey: queryKeys.email.senders(), queryFn: () => getSendersFn() })
  const team = useQuery({ queryKey: queryKeys.settings.team(), queryFn: () => getUsersFn() })

  const statuses: Partial<Record<SettingsSection, SectionStatus>> = {}

  const p = prospecting.data
  if (p && !p.managed) {
    statuses.source = !p.socialfetch.configured
      ? { level: 'error', text: 'Add your SocialFetch API key to search for prospects.', action: 'Add key' }
      : p.socialfetch.balanceHidden
        ? { level: 'ok', text: `Prospect search is set up. ${(p.socialfetch.prospectsThisMonth ?? 0).toLocaleString()} prospects found this month.` }
        : p.socialfetch.balance === null
        ? { level: 'warning', text: "Connected, but the credit balance couldn't be read.", action: 'Check' }
        : { level: 'ok', text: `SocialFetch connected, ${p.socialfetch.balance.toLocaleString()} credits left.` }

    const health = p.senderHealth
    statuses.verification =
      p.verification.provider !== 'reacher'
        ? { level: 'warning', text: 'Off, so found emails are unverified best guesses.', action: 'Set up' }
        : health?.level === 'critical'
          ? {
              level: 'error',
              text: health.problem === 'domain' ? 'The verification domain is on a blocklist.' : 'A verification IP is on a blocklist and needs replacing.',
              action: 'Fix',
            }
          : health?.level === 'warning'
            ? { level: 'warning', text: 'The verification setup needs attention.', action: 'Review' }
            : { level: 'ok', text: 'Reacher is checking found emails.' }
  }

  const s = sending.data
  if (s?.success) {
    const label = s.providers.find((d: { id: string; label: string }) => d.id === s.settings.provider)?.label ?? s.settings.provider
    statuses.sending = s.settings.credsUnreadable
      ? { level: 'error', text: `The saved ${label} credentials can't be read. Enter them again.`, action: 'Fix' }
      : s.settings.missingFields.length > 0
        ? { level: 'error', text: `${label} isn't fully set up yet, so nothing can be sent.`, action: 'Set up' }
        : !s.settings.defaultSender
          ? { level: 'warning', text: `Sending through ${label}, but there's no default sender.`, action: 'Choose' }
          : { level: 'ok', text: `Sending through ${label}, from ${s.settings.defaultSender}.` }
  }

  const senderCount = senders.data?.senders?.length
  if (senderCount !== undefined) {
    statuses.senders =
      senderCount === 0
        ? { level: 'warning', text: 'Add an address to send campaigns from.', action: 'Add' }
        : { level: 'ok', text: `${senderCount} ${senderCount === 1 ? 'address' : 'addresses'} to send from.` }
  }

  const c = copilot.data
  if (c) {
    const keys = [c.anthropic.isSet && 'Anthropic', c.openai.isSet && 'OpenAI'].filter(Boolean)
    statuses.copilot = c.credsUnreadable
      ? { level: 'error', text: "The saved API keys can't be read. Enter them again.", action: 'Fix' }
      : keys.length === 0
        ? { level: 'warning', text: 'Add an Anthropic or OpenAI key to use the copilot.', action: 'Add key' }
        : { level: 'ok', text: `Runs on your ${keys.join(' and ')} key.` }
  }

  const people = team.data?.success ? team.data.users?.length : undefined
  if (people !== undefined) {
    statuses.team = { level: 'info', text: `${people} ${people === 1 ? 'person' : 'people'} can sign in.` }
  }

  const isLoading = [prospecting, copilot, sending, senders, team].some((q) => q.isLoading)
  return { statuses, isLoading, managed: Boolean(p?.managed) }
}
