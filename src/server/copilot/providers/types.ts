/** A normalised event, whichever CLI produced it. */
export type CopilotEvent =
  | { type: 'session'; sessionId: string; model?: string; mcpConnected: boolean; mcpError?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; isError: boolean; preview: string }
  | { type: 'usage'; costUsd?: number; warning?: string }
  | { type: 'done'; text: string }
  /** `fatal`: retrying can't help (e.g. a rejected API key), so the CLI is stopped. */
  | { type: 'error'; message: string; fatal?: boolean }

export interface SpawnOptions {
  /** UUID we assign, so the session can be resumed after a restart. */
  sessionId: string
  systemPrompt: string
  /** HTTP endpoint the CLI should reach our in-process MCP server on. */
  mcpUrl: string
  /** Bearer token authorising that callback. */
  mcpToken: string
  model?: string
  /** Reasoning effort: low | medium | high | xhigh | max. Omit for the CLI's own default. */
  effort?: string
  /** Continue an existing CLI session rather than starting a new one. */
  resume: boolean
}

export interface CopilotProvider {
  id: string
  label: string
  description: string
  /**
   * Executable name, resolved through PATH. Fixed per provider and never taken
   * from request input — the previous harness passed the client-supplied
   * `provider` string straight to `spawn`.
   */
  command: string
  buildArgs: (opts: SpawnOptions) => string[]
  /** Parse one line of stdout into zero or more normalised events. */
  parseLine: (line: string) => CopilotEvent[]
  /** Encode one user turn for stdin. */
  encodeTurn: (text: string) => string
}
