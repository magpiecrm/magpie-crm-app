import { createFileRoute } from '@tanstack/react-router'
import {
  createSession,
  getSession,
  reviveSession,
  setPermissionMode,
  subscribeSession,
  updateClientState,
} from '../../../server/copilot/state'
import { sendTurn, takeClientActions } from '../../../server/copilot/session'
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '../../../server/copilot/permissions'
import type { CopilotClientState } from '../../../server/copilot/types'
import type { SessionEvent } from '../../../server/copilot/events'

interface TurnRequest {
  sessionId?: string
  provider?: string
  model?: string
  effort?: string
  message: string
  permissionMode?: PermissionMode
  clientState?: CopilotClientState
}

/**
 * Runs one copilot turn and streams the result as SSE.
 *
 * The previous harness buffered an entire multi-step run and returned it in one
 * lump, so a request that made four tool calls looked like a hang. Here each
 * token and each tool call is forwarded as it happens.
 */
export const Route = createFileRoute('/api/copilot/stream')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { requireAuth } = await import('../../../server/auth.server')
        try {
          await requireAuth()
        } catch {
          return new Response('Unauthorized', { status: 401 })
        }

        let body: TurnRequest
        try {
          body = await request.json()
        } catch {
          return new Response('Invalid JSON body', { status: 400 })
        }

        if (!body.message?.trim()) {
          return new Response('message is required', { status: 400 })
        }

        // Prefer a live session; fall back to reviving a stored chat (the agent
        // rebuilds the conversation from its transcript); otherwise start fresh.
        let session = body.sessionId ? getSession(body.sessionId) : undefined
        if (!session && body.sessionId) {
          const { db } = await import('../../../server/db')
          if (db.getCopilotChat(body.sessionId)) session = reviveSession(body.sessionId)
        }
        session ??= createSession()
        if (body.clientState) updateClientState(session.id, body.clientState)
        setPermissionMode(session.id, body.permissionMode ?? DEFAULT_PERMISSION_MODE)

        const encoder = new TextEncoder()
        const toolNamesUsed: string[] = []
        const toolsThisTurn: Array<{ name: string; status: string }> = []
        let assistantText = ''

        /**
         * Append this turn to the stored transcript.
         *
         * Persisted server-side rather than in the browser so the history
         * survives a reload, and so the agent can rebuild the conversation
         * from it after a restart.
         */
        const persistTurn = async (reply: string, isError: boolean) => {
          try {
            const { db } = await import('../../../server/db')
            const existing = db.getCopilotChat(session.id)
            const messages = [
              ...(existing?.messages ?? []),
              { role: 'user' as const, content: body.message },
              {
                role: 'assistant' as const,
                content: reply,
                ...(isError ? { isError: true } : {}),
                ...(toolsThisTurn.length ? { tools: toolsThisTurn } : {}),
              },
            ]
            db.saveCopilotChat({
              id: session.id,
              // Title the chat after its opening question.
              title: existing?.title || body.message.trim().slice(0, 60),
              messages,
            })
          } catch (err) {
            console.error('[copilot] failed to persist chat', err)
          }
        }

        const stream = new ReadableStream({
          start(controller) {
            let closed = false
            const send = (event: string, data: unknown) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
              } catch {
                closed = true
              }
            }
            let unsubscribe: () => void = () => {}
            const finish = () => {
              if (closed) return
              closed = true
              unsubscribe()
              try {
                controller.close()
              } catch {
                // Client already went away.
              }
            }

            send('session', { sessionId: session.id })

            // Subscribe BEFORE starting the turn, or its opening events could be
            // emitted before anyone is listening.
            unsubscribe = subscribeSession(session.id, (event: SessionEvent) => {
              switch (event.type) {
                case 'text':
                  assistantText += (assistantText ? '\n' : '') + event.text
                  send('text', { text: event.text })
                  break

                case 'tool_start':
                  toolNamesUsed.push(event.name)
                  toolsThisTurn.push({ name: event.name, status: 'running' })
                  send('tool', { phase: 'start', id: event.id, name: event.name, args: event.args })
                  break

                case 'tool_result': {
                  const record = toolsThisTurn.find(t => t.status === 'running')
                  if (record) record.status = event.isError ? 'error' : 'ok'
                  send('tool', { phase: 'result', id: event.id, isError: event.isError, preview: event.preview })
                  // Builder/persona mutations are queued by the tool handlers;
                  // forward them as soon as the call lands so the canvas updates
                  // mid-turn rather than only at the end.
                  const actions = takeClientActions(session.id)
                  if (actions.length > 0) send('actions', { actions })
                  break
                }

                case 'permission_request':
                  send('permission', {
                    id: event.id,
                    tool: event.tool,
                    args: event.args,
                    reason: event.reason,
                  })
                  break

                case 'usage':
                  if (event.warning) send('notice', { message: event.warning })
                  break

                case 'done': {
                  const actions = takeClientActions(session.id)
                  if (actions.length > 0) send('actions', { actions })
                  void persistTurn(event.text || assistantText, false)
                  send('done', { text: event.text, toolsUsed: toolNamesUsed, chatId: session.id })
                  finish()
                  break
                }

                case 'error':
                  void persistTurn(event.message, true)
                  send('error', { message: event.message })
                  finish()
                  break
              }
            })

            try {
              sendTurn({
                sessionId: session.id,
                providerId: body.provider || 'claude',
                message: body.message,
                model: body.model,
                effort: body.effort,
              })
            } catch (err: any) {
              send('error', { message: err?.message ?? String(err) })
              finish()
              return
            }

            request.signal?.addEventListener('abort', finish)
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            // Vite's dev proxy and most reverse proxies buffer without this.
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
