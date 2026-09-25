import { createFileRoute } from '@tanstack/react-router'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { buildMcpServer } from '../../../server/copilot/mcp'
import { getSessionByToken } from '../../../server/copilot/state'

/**
 * MCP endpoint the spawned CLI calls back into.
 *
 * Running the tool server in-process (rather than as a separate stdio child)
 * means tool handlers share this process's database connection and the live
 * per-session client state — no IPC, no second copy of the data layer.
 *
 * Authorisation is the per-session bearer token minted in `state.ts` and handed
 * to the CLI via --mcp-config. The user's own cookie session is not used here:
 * the caller is a subprocess, not a browser.
 */

async function handle({ request }: { request: Request }) {
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const session = getSessionByToken(token)

  if (!session) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unknown or expired copilot session' },
        id: null,
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // A stateless transport cannot be reused across requests, so build one (and
  // its server) per call. That is cheap — the MCP server object only registers
  // handlers; everything stateful lives in `state.ts`, keyed by our own session
  // id, which is what makes statelessness safe here.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  const server = buildMcpServer(session.id)
  await server.connect(transport)

  const response = await transport.handleRequest(request)
  // The SDK holds the server open for a streaming reply; close it once the
  // response has been handed back so we do not leak a handler per request.
  response.headers.get('content-type')?.includes('text/event-stream')
    ? void 0
    : await server.close().catch(() => {})
  return response
}

export const Route = createFileRoute('/api/copilot/mcp')({
  server: {
    handlers: {
      POST: handle,
      GET: handle,
      DELETE: handle,
    },
  },
})
