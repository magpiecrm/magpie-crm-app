import type { CopilotEvent, CopilotProvider, SpawnOptions } from './types'

const MCP_SERVER_NAME = 'emailmarketing'

/**
 * Claude Code CLI adapter.
 *
 * Verified against Claude Code 2.1.237. The CLI drives its own tool loop, so a
 * turn that needs five tool calls costs one process — the previous harness
 * re-spawned the CLI and replayed the whole conversation for each call.
 */
export const claudeProvider: CopilotProvider = {
  id: 'claude',
  label: 'Claude',
  description: 'Anthropic Claude Code CLI. Uses your local login.',
  command: 'claude',

  buildArgs(opts: SpawnOptions): string[] {
    const mcpConfig = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: opts.mcpUrl,
          headers: { authorization: `Bearer ${opts.mcpToken}` },
        },
      },
    }

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--mcp-config', JSON.stringify(mcpConfig),
      // Without this the user's own MCP servers (Google Drive, Gmail, ...) are
      // loaded into the copilot. `--tools ''` alone does NOT exclude them.
      '--strict-mcp-config',
      // Drop every built-in tool. The copilot has no business reading the
      // filesystem or running bash; its whole surface is our MCP server.
      '--tools', '',
      '--system-prompt', opts.systemPrompt,
      // Approval is enforced by our own permission layer before a tool is
      // exposed, so the CLI itself must not block waiting on a TTY prompt.
      '--permission-mode', 'bypassPermissions',
    ]

    if (opts.resume) {
      args.push('--resume', opts.sessionId)
    } else {
      args.push('--session-id', opts.sessionId)
    }

    if (opts.model) args.push('--model', opts.model)
    if (opts.effort) args.push('--effort', opts.effort)

    return args
  },

  parseLine(line: string): CopilotEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let msg: any
    try {
      msg = JSON.parse(trimmed)
    } catch {
      // The CLI occasionally writes non-JSON diagnostics to stdout; ignore
      // rather than tearing down the session over it.
      return []
    }

    switch (msg.type) {
      case 'system': {
        if (msg.subtype !== 'init') return []
        const server = (msg.mcp_servers ?? []).find((s: any) => s.name === MCP_SERVER_NAME)
        // MCP startup is async and non-blocking in the CLI, so `pending` here
        // just means the HTTP handshake hadn't finished at this instant — not
        // that it failed. Only the CLI's genuine failure states are worth
        // warning about; a tool call made while still pending either waits
        // for the connection or surfaces its own tool_result error.
        const isFailure = server && !['connected', 'pending'].includes(server.status)
        return [{
          type: 'session',
          sessionId: msg.session_id,
          model: msg.model,
          mcpConnected: server?.status === 'connected',
          mcpError: isFailure
            ? `MCP server status: ${server.status}`
            : server ? undefined : 'MCP server was not registered by the CLI',
        }]
      }

      case 'assistant': {
        const events: CopilotEvent[] = []
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            events.push({ type: 'text', text: block.text })
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'tool_start',
              id: block.id,
              // Strip the `mcp__<server>__` prefix the CLI adds.
              name: String(block.name).replace(/^mcp__[^_]+__/, ''),
              args: block.input,
            })
          }
        }
        return events
      }

      case 'user': {
        const events: CopilotEvent[] = []
        for (const block of msg.message?.content ?? []) {
          if (block.type !== 'tool_result') continue
          const text = Array.isArray(block.content)
            ? block.content.map((c: any) => c.text ?? '').join('')
            : String(block.content ?? '')
          events.push({
            type: 'tool_result',
            id: block.tool_use_id,
            isError: block.is_error === true,
            preview: text.slice(0, 400),
          })
        }
        return events
      }

      case 'rate_limit_event': {
        const info = msg.rate_limit_info
        if (!info || info.status === 'allowed') return []
        return [{
          type: 'usage',
          warning: `Rate limit ${Math.round((info.utilization ?? 0) * 100)}% of the ${info.rateLimitType ?? 'current'} window.`,
        }]
      }

      case 'result': {
        if (msg.is_error) {
          return [{
            type: 'error',
            message: msg.result || msg.api_error_status || `CLI reported ${msg.subtype}`,
          }]
        }
        return [
          { type: 'usage', costUsd: msg.total_cost_usd },
          { type: 'done', text: msg.result ?? '' },
        ]
      }

      default:
        return []
    }
  },

  encodeTurn(text: string): string {
    return JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    }) + '\n'
  },
}
