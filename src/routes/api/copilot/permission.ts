import { createFileRoute } from '@tanstack/react-router'
import { resolveApproval } from '../../../server/copilot/state'

/**
 * Resolve a tool call the copilot is blocked on.
 *
 * The matching tool handler is parked on a promise inside the MCP server, so
 * answering here either lets the call proceed or makes it return a decline the
 * model can react to. It never runs a denied tool.
 */
export const Route = createFileRoute('/api/copilot/permission')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { requireAuth } = await import('../../../server/auth.server')
        try {
          await requireAuth()
        } catch {
          return new Response('Unauthorized', { status: 401 })
        }

        let body: { sessionId?: string; requestId?: string; approved?: boolean }
        try {
          body = await request.json()
        } catch {
          return new Response('Invalid JSON body', { status: 400 })
        }

        if (!body.sessionId || !body.requestId || typeof body.approved !== 'boolean') {
          return new Response('sessionId, requestId and approved are required', { status: 400 })
        }

        const resolved = resolveApproval(body.sessionId, body.requestId, body.approved)
        return new Response(JSON.stringify({ resolved }), {
          status: resolved ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
