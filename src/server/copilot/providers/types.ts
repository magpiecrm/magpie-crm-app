/** A normalised copilot event, whichever model produced it. */
export type CopilotEvent =
  | { type: 'session'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; isError: boolean; preview: string }
  | { type: 'usage'; warning?: string }
  | { type: 'done'; text: string }
  /** `fatal`: retrying can't help (e.g. a rejected API key). */
  | { type: 'error'; message: string; fatal?: boolean }
