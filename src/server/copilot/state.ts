import crypto from 'crypto'
import type { ClientAction, CopilotClientState } from './types'
import type { SessionEvent } from './events'
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from './permissions'

/**
 * Per-conversation state shared between the SSE stream, the tool handlers and
 * the agent loop. They're reached from different requests, so this lives on
 * `globalThis`, which also survives Vite's module re-evaluation on HMR.
 */
export interface CopilotSessionState {
  id: string
  /** Latest browser-owned state, synced by the client on each turn. */
  clientState: CopilotClientState
  /** Mutations produced by `client` tools, drained by the SSE stream. */
  pendingClientActions: ClientAction[]
  permissionMode: PermissionMode
  /**
   * Tool calls blocked awaiting the user. The MCP handler holds the call open
   * on these promises, so an approval decision resolves the actual tool call
   * rather than merely annotating it after the fact.
   */
  pendingApprovals: Map<string, (approved: boolean) => void>
  /**
   * Live subscribers to this session — in practice the open SSE response. Both
   * the agent loop and the tool layer publish here, so an approval prompt
   * raised deep inside a tool handler reaches the browser.
   */
  listeners: Set<(event: SessionEvent) => void>
  /**
   * Design snapshots taken before each builder mutation, newest last, so a bad
   * edit can be rolled back. Capped — this is an "undo the last thing you did"
   * affordance, not full version history.
   */
  designHistory: Array<{ blocks: unknown[]; globalStyle: Record<string, unknown>; label: string }>
  /** Undo stack for the survey builder, kept apart from the email builder's. */
  surveyDesignHistory: Array<{ pages: unknown[]; theme: Record<string, unknown>; label: string }>
  createdAt: number
  lastUsedAt: number
}

const GLOBAL_KEY = Symbol.for('email-marketing:copilot-sessions')
const g = globalThis as any
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, CopilotSessionState>()

const sessions: Map<string, CopilotSessionState> = g[GLOBAL_KEY]

/** Sessions idle for longer than this are collected on the next access. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000

/** Called when a session ends, keyed so HMR re-registration replaces rather than adds. */
const END_KEY = Symbol.for('email-marketing:copilot-session-end')
if (!g[END_KEY]) g[END_KEY] = new Map<string, (id: string) => void>()
const endListeners: Map<string, (id: string) => void> = g[END_KEY]

/** Run `fn` whenever a session ends or expires, e.g. to free its conversation. */
export function onSessionEnd(name: string, fn: (id: string) => void) {
  endListeners.set(name, fn)
}

function sweep() {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, session] of sessions) {
    if (session.lastUsedAt < cutoff) endSession(id)
  }
}

export function createSession(id?: string): CopilotSessionState {
  sweep()
  const now = Date.now()
  const session: CopilotSessionState = {
    id: id ?? crypto.randomUUID(),
    clientState: {},
    pendingClientActions: [],
    permissionMode: DEFAULT_PERMISSION_MODE,
    pendingApprovals: new Map(),
    listeners: new Set(),
    designHistory: [],
    surveyDesignHistory: [],
    createdAt: now,
    lastUsedAt: now,
  }
  sessions.set(session.id, session)
  return session
}

/**
 * Re-create in-memory state for a stored chat. The agent rebuilds the
 * conversation from the saved transcript, so it carries on where it left off.
 */
export function reviveSession(id: string): CopilotSessionState {
  return sessions.get(id) ?? createSession(id)
}

export function getSession(id: string): CopilotSessionState | undefined {
  const session = sessions.get(id)
  if (session) session.lastUsedAt = Date.now()
  return session
}

export function updateClientState(id: string, patch: CopilotClientState) {
  const session = getSession(id)
  if (!session) return
  session.clientState = { ...session.clientState, ...patch }
}

/** Removes and returns the queued client mutations. */
export function drainClientActions(id: string): ClientAction[] {
  const session = getSession(id)
  if (!session) return []
  const actions = session.pendingClientActions
  session.pendingClientActions = []
  return actions
}

/** Publish an event to every live subscriber of this session. */
export function emitEvent(id: string, event: SessionEvent) {
  const session = sessions.get(id)
  if (!session) return
  for (const listener of session.listeners) {
    try {
      listener(event)
    } catch {
      // A dead SSE connection must not break the turn.
    }
  }
}

export function subscribeSession(id: string, listener: (event: SessionEvent) => void): () => void {
  const session = sessions.get(id)
  if (!session) return () => {}
  session.listeners.add(listener)
  return () => session.listeners.delete(listener)
}

/** How many design snapshots to keep per session. */
const MAX_DESIGN_HISTORY = 20

export function pushDesignSnapshot(
  session: CopilotSessionState,
  label: string,
) {
  const builder = session.clientState.builder
  if (!builder) return
  session.designHistory.push({
    blocks: builder.blocks,
    globalStyle: builder.globalStyle,
    label,
  })
  if (session.designHistory.length > MAX_DESIGN_HISTORY) session.designHistory.shift()
}

export function popDesignSnapshot(session: CopilotSessionState) {
  return session.designHistory.pop()
}

export function pushSurveyDesignSnapshot(session: CopilotSessionState, label: string) {
  const builder = session.clientState.surveyBuilder
  if (!builder) return
  session.surveyDesignHistory.push({ pages: builder.pages, theme: builder.theme, label })
  if (session.surveyDesignHistory.length > MAX_DESIGN_HISTORY) session.surveyDesignHistory.shift()
}

export function popSurveyDesignSnapshot(session: CopilotSessionState) {
  return session.surveyDesignHistory.pop()
}

export function setPermissionMode(id: string, mode: PermissionMode) {
  const session = getSession(id)
  if (session) session.permissionMode = mode
}

export function resolveApproval(id: string, requestId: string, approved: boolean): boolean {
  const session = getSession(id)
  const resolve = session?.pendingApprovals.get(requestId)
  if (!resolve) return false
  session!.pendingApprovals.delete(requestId)
  resolve(approved)
  return true
}

export function endSession(id: string) {
  const session = sessions.get(id)
  // Unblock anything still waiting, or its tool call would hang forever.
  session?.pendingApprovals.forEach(resolve => resolve(false))
  sessions.delete(id)
  for (const fn of endListeners.values()) fn(id)
}
