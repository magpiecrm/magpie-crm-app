// The copilot's agent loop. The app calls the model's API itself (Anthropic
// for Claude, OpenAI for GPT) with the user's own API key, and runs the tool
// loop in this process: the model asks for tools, we run them through the
// same approval gate and handlers the public MCP server uses, and send the
// results back until it answers. Both providers emit the same session events,
// so the chat UI can't tell them apart.
//
// The conversation lives here in memory, per chat and provider. After a
// restart (or a switch of provider mid-chat) it's rebuilt from the saved
// transcript's text, so an old chat carries on rather than starting cold.

import { z } from 'zod'
import { db } from '../db'
import { COPILOT_TOOLS, getTool } from './tools'
import { executeTool, sessionGate, sessionToolContext, type ToolOutcome } from './mcp'
import { buildSystemPrompt } from './prompt'
import { emitEvent, getSession, onSessionEnd } from './state'
import type { CopilotEvent } from './providers/types'
import type { CopilotTool } from './types'

/** Model calls in one turn, so a model stuck calling tools can't run up a bill. */
const MAX_STEPS = 40
const REQUEST_TIMEOUT_MS = 5 * 60_000

/** A tool call the model asked for, in either provider's shape. */
export interface ToolCall {
  id: string
  name: string
  /** Parsed arguments; undefined when the model sent invalid JSON. */
  args: unknown
}

/** One tool call with its result, for the adapter to send back. */
interface ToolResult {
  call: ToolCall
  outcome: ToolOutcome
}

/** What one model call produced. */
type StepResult =
  | {
      ok: true
      /** Everything to add to the conversation, exactly as the API returned it. */
      items: unknown[]
      texts: string[]
      calls: ToolCall[]
      /** Why the reply was cut short, if it was. */
      incomplete?: string
    }
  | { ok: false; message: string; fatal?: boolean }

interface CallOptions {
  apiKey: string
  model: string
  effort?: string
  system: string
  items: unknown[]
  tools: CopilotTool<any>[]
  signal: AbortSignal
  fetchImpl: typeof fetch
}

/** How the loop talks to one provider's API. */
export interface ModelAdapter {
  id: string
  label: string
  defaultModel: string
  requireKey(): string
  /** A plain-text conversation item, for the user's message or a saved transcript. */
  textItem(role: 'user' | 'assistant', text: string): unknown
  call(opts: CallOptions): Promise<StepResult>
  /** The items that hand tool results back to the model. */
  toolResultItems(results: ToolResult[]): unknown[]
}

export interface Turn {
  sessionId: string
  message: string
  model?: string
  effort?: string
}

interface Conversation {
  items: unknown[]
  /** Set while a turn is running; aborting it stops the turn. */
  abort: AbortController | null
}

const GLOBAL_KEY = Symbol.for('email-marketing:copilot-agent')
const g = globalThis as any
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, Conversation>()
const conversations: Map<string, Conversation> = g[GLOBAL_KEY]

// An expired or deleted chat frees its conversation (and any preview images in it).
onSessionEnd('agent', (id) => stopConversation(id))

const keyFor = (adapter: ModelAdapter, sessionId: string) => `${adapter.id}:${sessionId}`

/** Each tool's input as JSON Schema, from the same Zod shapes MCP uses. */
const schemas = new Map<string, Record<string, unknown>>()
export function toolSchema(tool: CopilotTool<any>): Record<string, unknown> {
  let schema = schemas.get(tool.name)
  if (!schema) {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(z.object(tool.input), { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>
    schema = rest
    schemas.set(tool.name, schema)
  }
  return schema
}

function conversationFor(adapter: ModelAdapter, sessionId: string): Conversation {
  const key = keyFor(adapter, sessionId)
  let conv = conversations.get(key)
  if (!conv) {
    const stored = db.getCopilotChat(sessionId)?.messages ?? []
    const items = stored
      .filter((m: any) => !m.isError && typeof m.content === 'string' && m.content.trim())
      .map((m: any) => adapter.textItem(m.role === 'user' ? 'user' : 'assistant', m.content))
    conv = { items, abort: null }
    conversations.set(key, conv)
  }
  return conv
}

async function runTool(sessionId: string, call: ToolCall): Promise<ToolOutcome> {
  const tool = getTool(call.name)
  if (!tool) return { isError: true, content: [{ type: 'text', text: `There is no tool called ${call.name}.` }] }
  if (call.args === undefined) {
    return { isError: true, content: [{ type: 'text', text: `${call.name} failed: its arguments weren't valid JSON.` }] }
  }
  // MCP validates arguments before a handler runs; do the same here.
  const parsed = z.object(tool.input).safeParse(call.args)
  if (!parsed.success) {
    return { isError: true, content: [{ type: 'text', text: `${call.name} failed: invalid arguments.\n${z.prettifyError(parsed.error)}` }] }
  }
  return executeTool(tool, parsed.data, sessionToolContext(sessionId), sessionGate(sessionId))
}

/**
 * Runs one user turn to completion. Never throws: failures arrive as an
 * `error` event, and the turn is rolled back so a half-finished tool call
 * never poisons the next request.
 */
export async function runTurn(adapter: ModelAdapter, turn: Turn, fetchImpl: typeof fetch = fetch): Promise<void> {
  const emit = (event: CopilotEvent) => emitEvent(turn.sessionId, event)
  if (!getSession(turn.sessionId)) {
    emit({ type: 'error', message: 'Copilot session not found. Reload the page and try again.' })
    return
  }
  const conv = conversationFor(adapter, turn.sessionId)
  if (conv.abort) {
    emit({ type: 'error', message: 'The copilot is still answering your previous message.' })
    return
  }

  let apiKey: string
  try {
    apiKey = adapter.requireKey()
  } catch (err: any) {
    emit({ type: 'error', message: err.message, fatal: true })
    return
  }

  const model = turn.model && /^[A-Za-z0-9._:-]{1,100}$/.test(turn.model) ? turn.model : adapter.defaultModel
  const abort = new AbortController()
  conv.abort = abort
  const before = conv.items.length
  conv.items.push(adapter.textItem('user', turn.message))
  emit({ type: 'session', sessionId: turn.sessionId, model })

  let lastText = ''
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      let brand: Record<string, any> | null = null
      try {
        brand = db.getBrandKit()
      } catch {
        // Brand kit is optional; never block a turn on it.
      }
      const result = await adapter.call({
        apiKey,
        model,
        effort: turn.effort,
        // Rebuilt each step, so it always reflects the page the user is on.
        system: buildSystemPrompt(getSession(turn.sessionId)?.clientState ?? {}, brand),
        items: conv.items,
        tools: COPILOT_TOOLS,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        fetchImpl,
      })
      if (!result.ok) {
        conv.items.length = before
        emit({ type: 'error', message: result.message, fatal: result.fatal })
        return
      }

      conv.items.push(...result.items)
      for (const text of result.texts) {
        lastText = text
        emit({ type: 'text', text })
      }

      if (result.calls.length === 0) {
        if (result.incomplete) emit({ type: 'usage', warning: `The reply was cut short (${result.incomplete}).` })
        emit({ type: 'done', text: lastText })
        return
      }

      // One at a time: approvals are asked in order, and each call sees the
      // design as the previous one left it.
      const results: ToolResult[] = []
      for (const call of result.calls) {
        emit({ type: 'tool_start', id: call.id, name: call.name, args: call.args ?? {} })
        const outcome = await runTool(turn.sessionId, call)
        if (abort.signal.aborted) throw new DOMException('Stopped', 'AbortError')
        const text = outcome.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
        emit({ type: 'tool_result', id: call.id, isError: outcome.isError === true, preview: text.slice(0, 400) })
        results.push({ call, outcome })
      }
      conv.items.push(...adapter.toolResultItems(results))
    }
    conv.items.length = before
    emit({ type: 'error', message: `Stopped after ${MAX_STEPS} steps without finishing. Try breaking the request into smaller parts.` })
  } catch (err: any) {
    conv.items.length = before
    // Stopped on purpose (chat deleted): nobody is listening.
    if (abort.signal.aborted) return
    emit({
      type: 'error',
      message:
        err?.name === 'TimeoutError'
          ? `${adapter.label} took too long to answer. Try again.`
          : `Couldn't reach ${adapter.label}. Check this server's internet connection and try again.`,
    })
  } finally {
    conv.abort = null
  }
}

export function isTurnRunning(sessionId: string): boolean {
  for (const [key, conv] of conversations) {
    if (key.endsWith(`:${sessionId}`) && conv.abort) return true
  }
  return false
}

/** Stops a running turn and forgets the conversation, for every provider. */
export function stopConversation(sessionId: string) {
  for (const [key, conv] of conversations) {
    if (!key.endsWith(`:${sessionId}`)) continue
    conv.abort?.abort()
    conversations.delete(key)
  }
}

/** Reads an API error body's message, if it has one. */
export async function errorBody(res: Response): Promise<any> {
  try {
    return (await res.json())?.error ?? null
  } catch {
    return null
  }
}
