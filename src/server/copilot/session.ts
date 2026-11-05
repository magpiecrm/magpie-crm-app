import { getAdapter } from './providers'
import { copilotManaged, MANAGED_EFFORT, MANAGED_MODEL } from './managedAi'
import { runTurn, stopConversation } from './agent'
import { drainClientActions } from './state'

export interface TurnOptions {
  sessionId: string
  /** "claude" or "openai". */
  providerId: string
  message: string
  model?: string
  effort?: string
}

/**
 * Send one user turn. It runs in this process (see agent.ts) and reports back
 * through the session's event bus, which the SSE stream is subscribed to.
 * Throws only for an unknown provider; everything else arrives as events.
 */
export function sendTurn(opts: TurnOptions): void {
  // Where the host runs the copilot there's one model, whatever the chat asked for.
  const managed = copilotManaged()
  const adapter = getAdapter(managed ? 'claude' : opts.providerId)
  const model = managed ? MANAGED_MODEL : opts.model
  const effort = managed ? MANAGED_EFFORT : opts.effort
  void runTurn(adapter, { sessionId: opts.sessionId, message: opts.message, model, effort })
}

/** Drain any client-side mutations queued by tools during this turn. */
export function takeClientActions(sessionId: string) {
  return drainClientActions(sessionId)
}

export function stopSession(sessionId: string) {
  stopConversation(sessionId)
}
