import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { getCopilotChatFn } from '../../server/functions'
import type { CopilotClientState } from '../../server/copilot/types'

export type PermissionMode = 'ask' | 'auto-safe' | 'bypass'

export interface ToolCall {
  id: string
  name: string
  args: unknown
  status: 'running' | 'ok' | 'error'
  preview?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  /** Tool calls made while producing this message, in order. */
  tools?: ToolCall[]
}

export interface PendingPermission {
  id: string
  tool: string
  args: unknown
  reason: string
}

interface ClientAction {
  action: string
  args: any
}

/**
 * Which caches a given tool invalidates. Replaces the old blanket
 * `queryClient.invalidateQueries()`, which refetched every query in the app
 * after any successful copilot turn.
 */
const TOOL_INVALIDATIONS: Record<string, Array<readonly unknown[]>> = {
  createList: [queryKeys.email.lists()],
  deleteList: [queryKeys.email.lists()],
  addContacts: [queryKeys.email.lists(), queryKeys.email.contacts(), queryKeys.email.contactsAll()],
  createCampaign: [queryKeys.email.campaigns()],
  updateCampaign: [queryKeys.email.campaigns()],
  deleteCampaign: [queryKeys.email.campaigns()],
  duplicateCampaign: [queryKeys.email.campaigns()],
  // The survey builder only reads its query on mount, so refreshing these never resets an open design.
  createSurvey: [queryKeys.surveys.list()],
  updateSurvey: [queryKeys.surveys.list()],
  publishSurvey: [queryKeys.surveys.list()],
  closeSurvey: [queryKeys.surveys.list()],
  duplicateSurvey: [queryKeys.surveys.list()],
  deleteSurvey: [queryKeys.surveys.list()],
  createContactField: [queryKeys.email.contactFields()],
  createSavedTemplate: [queryKeys.templates.list()],
  updateSavedTemplate: [queryKeys.templates.list()],
  duplicateSavedTemplate: [queryKeys.templates.list()],
  deleteSavedTemplate: [queryKeys.templates.list()],
  // Tasks and proposals: every sales query (deals' timelines show them too).
  addTask: [['sales']],
  updateTask: [['sales']],
  deleteTask: [['sales']],
  createProposal: [['sales']],
  renameProposal: [['sales']],
  shareProposal: [['sales']],
  sendProposal: [['sales']],
  deleteProposal: [['sales']],
  // Sequences: the list, each sequence and its people (all under ['sequences']).
  createSequence: [queryKeys.sequences.list()],
  updateSequence: [queryKeys.sequences.list()],
  setSequenceStatus: [queryKeys.sequences.list()],
  enrollInSequence: [queryKeys.sequences.list(), ['email', 'contact']],
  updateEnrollments: [queryKeys.sequences.list(), ['email', 'contact']],
}

interface UseCopilotStreamOptions {
  /** Snapshot of browser-owned state, sent with each turn. */
  getClientState: () => CopilotClientState
  /** Apply a mutation a `client` tool produced. */
  onClientAction?: (action: ClientAction) => void
  greeting: string
}

/**
 * Drives one copilot conversation over SSE.
 *
 * The server keeps the conversation for the session, so the transcript is
 * not re-sent — `sessionId` is the only continuity the client needs.
 */
export function useCopilotStream({ getClientState, onClientAction, greeting }: UseCopilotStreamOptions) {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: greeting }])
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const [activeTools, setActiveTools] = useState<ToolCall[]>([])
  const sessionIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const respondToPermission = useCallback(async (id: string, approved: boolean) => {
    setPendingPermission(null)
    await fetch('/api/copilot/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionIdRef.current, requestId: id, approved }),
    }).catch(() => {})
  }, [])

  const send = useCallback(
    async (text: string, opts: { provider: string; model?: string; effort?: string; permissionMode: PermissionMode }) => {
      if (!text.trim() || isStreaming) return

      setMessages(prev => [...prev, { role: 'user', content: text }])
      setIsStreaming(true)
      setActiveTools([])

      const controller = new AbortController()
      abortRef.current = controller
      const tools: ToolCall[] = []
      let assistantText = ''

      const finalise = (content: string, isError = false) => {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: content || '(no response)', isError, tools: tools.length ? [...tools] : undefined },
        ])
        setActiveTools([])
        setIsStreaming(false)
      }

      try {
        const response = await fetch('/api/copilot/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            provider: opts.provider,
            model: opts.model || undefined,
            effort: opts.effort || undefined,
            permissionMode: opts.permissionMode,
            message: text,
            clientState: getClientState(),
          }),
        })

        if (!response.ok || !response.body) {
          finalise(
            response.status === 401
              ? 'Your session expired — reload the page and sign in again.'
              : `The copilot request failed (HTTP ${response.status}).`,
            true,
          )
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // SSE frames are separated by a blank line.
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''

          for (const frame of frames) {
            const eventLine = frame.split('\n').find(l => l.startsWith('event: '))
            const dataLine = frame.split('\n').find(l => l.startsWith('data: '))
            if (!eventLine || !dataLine) continue

            const event = eventLine.slice(7).trim()
            let data: any
            try {
              data = JSON.parse(dataLine.slice(6))
            } catch {
              continue
            }

            switch (event) {
              case 'session':
                sessionIdRef.current = data.sessionId
                break

              case 'text':
                assistantText += (assistantText ? '\n' : '') + data.text
                break

              case 'tool': {
                if (data.phase === 'start') {
                  tools.push({ id: data.id, name: data.name, args: data.args, status: 'running' })
                } else {
                  const call = tools.find(t => t.id === data.id)
                  if (call) {
                    call.status = data.isError ? 'error' : 'ok'
                    call.preview = data.preview
                  }
                }
                setActiveTools([...tools])
                break
              }

              case 'permission':
                setPendingPermission({ id: data.id, tool: data.tool, args: data.args, reason: data.reason })
                break

              case 'actions':
                for (const action of data.actions ?? []) onClientAction?.(action)
                break

              case 'notice':
                assistantText += `\n\n_${data.message}_`
                break

              case 'error':
                finalise(data.message, true)
                return

              case 'done': {
                if (data.chatId) sessionIdRef.current = data.chatId
                // The transcript is stored server-side, so the list of past
                // chats has just changed.
                queryClient.invalidateQueries({ queryKey: queryKeys.copilot.chats() })
                // Refetch only what the tools that actually ran can have changed.
                const keys = new Set<string>()
                for (const name of data.toolsUsed ?? []) {
                  for (const key of TOOL_INVALIDATIONS[name] ?? []) keys.add(JSON.stringify(key))
                }
                for (const key of keys) {
                  queryClient.invalidateQueries({ queryKey: JSON.parse(key) })
                }
                finalise(data.text || assistantText)
                return
              }
            }
          }
        }

        // Stream ended without a `done` frame — surface whatever arrived.
        finalise(assistantText || 'The copilot stopped unexpectedly.', !assistantText)
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          finalise(assistantText || 'Stopped.', false)
        } else {
          finalise(`Could not reach the copilot: ${err?.message ?? err}`, true)
        }
      } finally {
        abortRef.current = null
      }
    },
    [getClientState, isStreaming, onClientAction, queryClient],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  /**
   * Start a new conversation. Dropping the session id means the next turn
   * spawns a fresh agent process; the previous chat stays in the history.
   */
  const newChat = useCallback(() => {
    abortRef.current?.abort()
    sessionIdRef.current = null
    setMessages([{ role: 'assistant', content: greeting }])
    setActiveTools([])
    setPendingPermission(null)
  }, [greeting])

  /**
   * Open a stored chat. Adopting its id means the next message resumes the
   * agent session rather than starting cold, so it still remembers.
   */
  const loadChat = useCallback(
    async (id: string) => {
      abortRef.current?.abort()
      setActiveTools([])
      setPendingPermission(null)
      try {
        const res: any = await getCopilotChatFn({ data: { id } })
        if (!res?.chat) {
          setMessages([{ role: 'assistant', content: 'That conversation could not be found.', isError: true }])
          return
        }
        sessionIdRef.current = id
        setMessages(
          res.chat.messages.length > 0
            ? res.chat.messages
            : [{ role: 'assistant', content: greeting }],
        )
      } catch (err: any) {
        setMessages([
          { role: 'assistant', content: `Could not open that conversation: ${err?.message ?? err}`, isError: true },
        ])
      }
    },
    [greeting],
  )

  /** The chat currently open, or null for an unsaved new one. */
  const currentChatId = sessionIdRef.current

  return {
    messages,
    isStreaming,
    activeTools,
    pendingPermission,
    currentChatId,
    send,
    stop,
    newChat,
    loadChat,
    respondToPermission,
  }
}
