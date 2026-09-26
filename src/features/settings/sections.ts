/**
 * The settings pages, grouped for the side menu. Each has a plain name and a
 * one-line intro shown at the top of its page, so it's clear what it's for.
 */
export const SETTINGS_SECTIONS = [
  { id: 'overview', group: null, label: 'Overview', intro: "This month's usage, what's set up, and what needs your attention." },
  { id: 'source', group: 'Prospecting', label: 'Data source', intro: 'The SocialFetch account that prospect search uses to find companies and people.' },
  { id: 'verification', group: 'Prospecting', label: 'Email verification', intro: 'How found email addresses are checked before they are shown or saved, and the health of the servers that check them.' },
  { id: 'sending', group: 'Email', label: 'Sending', intro: 'The service your campaigns are sent through, and the default address they come from.' },
  { id: 'senders', group: 'Email', label: 'Sender addresses', intro: 'The names and addresses you can send campaigns from.' },
  { id: 'copilot', group: 'AI', label: 'Copilot', intro: 'Your own Anthropic or OpenAI API key, which the in-app copilot runs on.' },
  { id: 'mcp', group: 'AI', label: 'Connect AI apps', intro: 'Let Claude, ChatGPT, Cursor and other AI apps work with your data through MCP.' },
  { id: 'team', group: 'Workspace', label: 'Team and login', intro: 'Who can sign in, and your own password.' },
  { id: 'fields', group: 'Workspace', label: 'Contact fields', intro: 'Extra fields stored on contacts, for forms, surveys and personalisation.' },
  { id: 'api', group: 'Workspace', label: 'Signup forms and API', intro: 'Keys that let your website add subscribers through the signup API.' },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

/** Old `?tab=` values from before the regroup, so existing links keep working. */
const LEGACY: Record<string, SettingsSection> = { prospecting: 'source', users: 'team' }

export function parseSettingsSection(value: unknown): SettingsSection | undefined {
  if (typeof value !== 'string') return undefined
  if (value in LEGACY) return LEGACY[value]
  return SETTINGS_SECTIONS.some((s) => s.id === value) ? (value as SettingsSection) : undefined
}
