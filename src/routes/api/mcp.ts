import { createFileRoute } from '@tanstack/react-router'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { buildPublicMcpServer } from '../../server/copilot/mcp'

/**
 * Public MCP endpoint for outside AI apps: Claude (Code, Desktop), ChatGPT and
 * the OpenAI API, Cursor, and anything else that speaks MCP over Streamable
 * HTTP. Set up from Settings → Connect AI apps.
 *
 * Authorisation is an MCP key (`vtl_mcp_…`) sent as a Bearer token. Those keys
 * are their own scope: the public-API keys used by signup forms (which may sit
 * in a website's code) don't work here, and MCP keys don't work there.
 *
 * The tools are the copilot's server-side tools (see `PUBLIC_TOOLS`). The
 * outside app asks its own user before running anything that isn't read-only,
 * guided by each tool's read-only / destructive hints.
 */

function unauthorized(message: string) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="mcp"' },
  })
}

async function handle({ request }: { request: Request }) {
  const auth = request.headers.get('authorization') ?? ''
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!key) return unauthorized('Missing MCP key. Create one in Settings → Connect AI apps and send it as "Authorization: Bearer <key>".')

  const { db } = await import('../../server/db')
  if (!db.verifyApiKey(key, 'mcp')) return unauthorized('Unknown or revoked MCP key.')

  // Stateless: a fresh transport and server per request, as the copilot's own
  // endpoint does. Nothing here keeps per-connection state.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  const server = buildPublicMcpServer()
  await server.connect(transport)
  const response = await transport.handleRequest(request)
  if (!response.headers.get('content-type')?.includes('text/event-stream')) await server.close().catch(() => {})
  return response
}

export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: handle,
      GET: handle,
      DELETE: handle,
    },
  },
})
