import { getTool } from './tools'

/**
 * Permission ladder, modelled on Paseo's provider modes.
 *
 * The distinction that matters is reversibility, not read-vs-write: creating a
 * draft campaign is trivially undone, whereas adding 400 contacts to a list or
 * deleting one is not.
 */
export type PermissionMode = 'ask' | 'auto-safe' | 'bypass'

export const PERMISSION_MODES: Array<{
  id: PermissionMode
  label: string
  description: string
}> = [
  {
    id: 'ask',
    label: 'Always ask',
    description: 'Approve every tool that changes something.',
  },
  {
    id: 'auto-safe',
    label: 'Auto-approve safe edits',
    description: 'Reads and design edits run freely; destructive changes still ask.',
  },
  {
    id: 'bypass',
    label: 'Bypass',
    description: 'Run everything without prompting.',
  },
]

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto-safe'

/** Whether a tool call needs explicit user approval under the given mode. */
export function needsApproval(toolName: string, mode: PermissionMode): boolean {
  const tool = getTool(toolName)
  // An unknown tool is never auto-approved — it will fail anyway, but if the
  // registry ever gains a tool without metadata, ask rather than assume.
  if (!tool) return mode !== 'bypass'
  if (tool.readOnly) return false

  switch (mode) {
    case 'bypass':
      return false
    case 'auto-safe':
      return tool.destructive === true
    case 'ask':
      return true
  }
}
