// Runs the copilot on OpenAI models with the user's own OpenAI API key.
//
// Unlike Claude (the Claude Code CLI, a subprocess that calls our tools over
// MCP), this calls OpenAI's Responses API directly and runs the tool loop in
// this process. It uses the same tools, approval gate, system prompt and
// session events, so the chat UI can't tell the two apart.
//
// Requests use `store: false`, so OpenAI doesn't keep the conversation (beyond
// its standard abuse-monitoring retention). The history lives here in memory
// instead; after a restart it's rebuilt from the saved chat transcript.

import { z } from 'zod'
import { db } from '../db'
import { COPILOT_TOOLS, getTool } from './tools'
import { executeTool, sessionGate, sessionToolContext, type ToolOutcome } from './mcp'
import { buildSystemPrompt } from './prompt'
import { emitEvent, getSession } from './state'
import { requireOpenAIKey } from './settings'
import type { CopilotEvent } from './providers/types'

const OPENAI_DEFAULT_MODEL = 'gpt-6-sol'
const API_URL = 'https://api.openai.com/v1/responses'
/** Model calls in one turn, so a model stuck calling tools can't run up a bill. */
const MAX_STEPS = 40
const REQUEST_TIMEOUT_MS = 5 * 60_000
const EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max'])

interface Conversation {
  /** Everything sent and received so far, as Responses API input items. */
  items: any[]
  /** Set while a turn is running; aborting it stops the turn. */
  abort: AbortController | null
}

const GLOBAL_KEY = Symbol.for('email-marketing:copilot-openai')
const g = globalThis as any
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, Conversation>()
const conversations: Map<string, Conversation> = g[GLOBAL_KEY]

export interface OpenAITurn {
  sessionId: string
  message: string
  model?: string
  effort?: string
}

let toolDefs: unknown[] | null = null

/** The copilot's tools as OpenAI function tools, from the same Zod shapes MCP uses. */
export function openAITools(): unknown[] {
  toolDefs ??= COPILOT_TOOLS.map((tool) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(z.object(tool.input), { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>
    return { type: 'function', name: tool.name, description: tool.description, parameters, strict: false }
  })
  return toolDefs
}

/**
 * The conversation so far. After a restart (or a switch from Claude) nothing
 * is in memory, so it starts from the saved transcript's text.
 */
function conversationFor(sessionId: string): Conversation {
  let conv = conversations.get(sessionId)
  if (!conv) {
    const stored = db.getCopilotChat(sessionId)?.messages ?? []
    const items = stored
      .filter((m: any) => !m.isError && typeof m.content === 'string' && m.content.trim())
      .map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    conv = { items, abort: null }
    conversations.set(sessionId, conv)
  }
  return conv
}

/** A sent item without the id OpenAI gave it: with `store: false` ids can't be referred back to. */
function replayable(item: any): any {
  if (item?.type === 'message' || item?.type === 'function_call') {
    const { id: _id, ...rest } = item
    return rest
  }
  return item
}

function outputText(item: any): string {
  return (item.content ?? [])
    .filter((c: any) => c.type === 'output_text' && c.text)
    .map((c: any) => c.text)
    .join('')
}

/** Tool output as OpenAI takes it: plain text, or text plus the rendered image. */
function toolOutput(outcome: ToolOutcome): string | unknown[] {
  if (!outcome.content.some((c) => c.type === 'image')) {
    return outcome.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
  }
  return outcome.content.map((c) =>
    c.type === 'text' ? { type: 'input_text', text: c.text } : { type: 'input_image', image_url: `data:${c.mimeType};base64,${c.data}` },
  )
}

async function runTool(sessionId: string, call: any): Promise<ToolOutcome> {
  const tool = getTool(call.name)
  if (!tool) return { isError: true, content: [{ type: 'text', text: `There is no tool called ${call.name}.` }] }
  let args: unknown
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {}
  } catch {
    return { isError: true, content: [{ type: 'text', text: `${call.name} failed: its arguments weren't valid JSON.` }] }
  }
  // MCP validates arguments before a handler runs; do the same here.
  const parsed = z.object(tool.input).safeParse(args)
  if (!parsed.success) {
    return { isError: true, content: [{ type: 'text', text: `${call.name} failed: invalid arguments.\n${z.prettifyError(parsed.error)}` }] }
  }
  return executeTool(tool, parsed.data, sessionToolContext(sessionId), sessionGate(sessionId))
}

/** An API failure in words the user can act on. `fatal`: retrying won't help. */
async function describeFailure(res: Response, model: string): Promise<{ message: string; fatal?: boolean }> {
  let error: any = null
  try {
    error = (await res.json())?.error
  } catch {
    // Not JSON; fall back to the status.
  }
  if (res.status === 401) return { message: 'OpenAI rejected the copilot\'s API key. Check it in Settings → Copilot.', fatal: true }
  if (res.status === 403) return { message: 'This OpenAI API key isn\'t allowed to use this model or the API. Check its project and permissions on the OpenAI platform.', fatal: true }
  if (error?.code === 'insufficient_quota') return { message: 'The OpenAI account behind this key has run out of credit. Add some on the OpenAI platform.', fatal: true }
  if (error?.code === 'model_not_found' || res.status === 404) return { message: `OpenAI doesn't offer the model "${model}" to this key. Pick another model.`, fatal: true }
  if (res.status === 429) return { message: 'OpenAI is rate-limiting this key. Try again in a minute.' }
  return { message: `OpenAI returned HTTP ${res.status}${error?.message ? `: ${error.message}` : '.'}` }
}

/**
 * Runs one user turn to completion, emitting the same events as the Claude
 * CLI provider. Never throws: failures arrive as an `error` event.
 */
export async function runOpenAITurn(turn: OpenAITurn, fetchImpl: typeof fetch = fetch): Promise<void> {
  const emit = (event: CopilotEvent) => emitEvent(turn.sessionId, event)
  const session = getSession(turn.sessionId)
  if (!session) {
    emit({ type: 'error', message: 'Copilot session not found. Reload the page and try again.' })
    return
  }
  const conv = conversationFor(turn.sessionId)
  if (conv.abort) {
    emit({ type: 'error', message: 'The copilot is still answering your previous message.' })
    return
  }

  let apiKey: string
  try {
    apiKey = requireOpenAIKey()
  } catch (err: any) {
    emit({ type: 'error', message: err.message, fatal: true })
    return
  }

  const model = turn.model && /^[A-Za-z0-9._:-]{1,100}$/.test(turn.model) ? turn.model : OPENAI_DEFAULT_MODEL
  const effort = turn.effort && EFFORTS.has(turn.effort) ? turn.effort : undefined
  const abort = new AbortController()
  conv.abort = abort
  // A failed turn is rolled back, so a half-finished tool call never poisons
  // the next request ("no tool output found for function call").
  const before = conv.items.length
  conv.items.push({ role: 'user', content: turn.message })

  emit({ type: 'session', sessionId: turn.sessionId, model, mcpConnected: true })

  let lastText = ''
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      let brand: Record<string, any> | null = null
      try {
        brand = db.getBrandKit()
      } catch {
        // Brand kit is optional; never block a turn on it.
      }
      const res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          // Rebuilt each step, so it always reflects the page the user is on.
          instructions: buildSystemPrompt(getSession(turn.sessionId)?.clientState ?? {}, brand),
          input: conv.items,
          tools: openAITools(),
          store: false,
          include: ['reasoning.encrypted_content'],
          ...(effort ? { reasoning: { effort } } : {}),
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      })
      if (!res.ok) {
        conv.items.length = before
        emit({ type: 'error', ...(await describeFailure(res, model)) })
        return
      }

      const json: any = await res.json()
      const output: any[] = json.output ?? []
      conv.items.push(...output.map(replayable))

      const calls: any[] = []
      for (const item of output) {
        if (item.type === 'message') {
          const text = outputText(item)
          if (text) {
            lastText = text
            emit({ type: 'text', text })
          }
        } else if (item.type === 'function_call') {
          calls.push(item)
        }
      }

      if (calls.length === 0) {
        if (json.status === 'incomplete') {
          emit({ type: 'usage', warning: `The reply was cut short (${json.incomplete_details?.reason ?? 'incomplete'}).` })
        }
        emit({ type: 'done', text: lastText })
        return
      }

      // One at a time: approvals are asked in order, and each call sees the
      // design as the previous one left it.
      for (const call of calls) {
        let args: unknown = {}
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {}
        } catch {
          // runTool reports it.
        }
        emit({ type: 'tool_start', id: call.call_id, name: call.name, args })
        const outcome = await runTool(turn.sessionId, call)
        if (abort.signal.aborted) throw new DOMException('Stopped', 'AbortError')
        const text = outcome.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
        emit({ type: 'tool_result', id: call.call_id, isError: outcome.isError === true, preview: text.slice(0, 400) })
        conv.items.push({ type: 'function_call_output', call_id: call.call_id, output: toolOutput(outcome) })
      }
    }
    conv.items.length = before
    emit({ type: 'error', message: `Stopped after ${MAX_STEPS} steps without finishing. Try breaking the request into smaller parts.` })
  } catch (err: any) {
    conv.items.length = before
    // Stopped on purpose (chat deleted, stream closed): nobody is listening.
    if (abort.signal.aborted) return
    emit({
      type: 'error',
      message: err?.name === 'TimeoutError' ? 'OpenAI took too long to answer. Try again.' : 'Couldn\'t reach OpenAI. Check this server\'s internet connection and try again.',
    })
  } finally {
    conv.abort = null
  }
}

export function isOpenAITurnRunning(sessionId: string): boolean {
  return Boolean(conversations.get(sessionId)?.abort)
}

/** Stops a running turn and forgets the conversation. */
export function stopOpenAISession(sessionId: string) {
  conversations.get(sessionId)?.abort?.abort()
  conversations.delete(sessionId)
}
