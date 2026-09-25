import type { CopilotEvent } from './providers/types'

/** A tool call waiting on the user before it may run. */
export interface PermissionRequest {
  type: 'permission_request'
  id: string
  tool: string
  args: unknown
  /** Why it is being gated, shown in the UI. */
  reason: string
}

/**
 * Everything that can be pushed to a live copilot stream: provider output plus
 * approval requests raised by our own tool layer.
 */
export type SessionEvent = CopilotEvent | PermissionRequest
