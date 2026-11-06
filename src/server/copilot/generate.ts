// One model call for work that isn't a chat (personalised sequence emails,
// sequences/personalise.ts): a prompt in, an answer out through one tool the
// model is asked to call, so it comes back checked against a Zod shape.
// Forced tool choice is refused by current models, and the host's relay
// overrides `output_config`, so a tool is the one way that works everywhere.
//
// It runs where the copilot does: on the host's AI where it runs the copilot
// (managedAi.ts, charged to the AI budget), else with this copy's own key.
// Always Claude Haiku 5.5 at effort max, as the host runs it; with only an
// OpenAI key, the OpenAI adapter's default model, without web tools. Claude's
// own web search and fetch can be lent to a call: they run at Anthropic, so
// nothing goes through our web search (webSearch.ts) or its proxy.

import { z, type ZodRawShape } from 'zod'
import type { CallOptions, ModelAdapter, ToolCall } from './agent'
import { aiAvailable } from './availability'
import { copilotManaged, MANAGED_EFFORT, MANAGED_MODEL } from './managedAi'
import { anthropicAdapter } from './providers/anthropic'
import { openaiAdapter } from './providers/openai'
import { hasKey } from './settings'
import type { CopilotTool } from './types'

export { aiAvailable, type AiAvailability } from './availability'

export const GENERATE_MODEL = 'claude-haiku-5-5'
export const GENERATE_EFFORT = 'max'
/** The versions every Claude model takes (the newer ones, with filtering, aren't documented for Haiku 5.5). */
export const WEB_SEARCH_TOOL = 'web_search_20250305'
export const WEB_FETCH_TOOL = 'web_fetch_20250910'
/**
 * The longest reply. At effort max its thinking alone used all of the
 * copilot's 32,000 on a company's research, leaving no answer (dev copy,
 * 2026-11-06); the host's relay allows this much.
 */
export const GENERATE_MAX_TOKENS = 64_000

/** A reply that long, with web searches, takes several minutes. */
const TIMEOUT_MS = 10 * 60_000
/** Calls in one answer: a paused web turn continued, or a nudge to use the tool. */
const MAX_CALLS = 5

/** The AI can't be used at all (no key, no budget, a key it refused): asking again won't help until that's fixed. */
export class AiUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnavailable'
  }
}

/** This one call failed (busy, overloaded, no usable answer): another try may work. */
export class AiFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiFailed'
  }
}

function pick(): { adapter: ModelAdapter; model: string; effort?: string } {
  if (copilotManaged()) return { adapter: anthropicAdapter, model: MANAGED_MODEL, effort: MANAGED_EFFORT }
  if (hasKey('anthropicApiKey')) return { adapter: anthropicAdapter, model: GENERATE_MODEL, effort: GENERATE_EFFORT }
  if (hasKey('openaiApiKey')) return { adapter: openaiAdapter, model: openaiAdapter.defaultModel }
  throw new AiUnavailable((aiAvailable() as { reason: string }).reason)
}

export interface GenerateOptions<S extends ZodRawShape> {
  system: string
  prompt: string
  /** The tool the answer comes back through. Its name must be unique among the app's tools (toolSchema keeps schemas by name). */
  answer: { name: string; description: string; input: S }
  /** Claude's own web search and fetch, at most this many uses each. Left out where only OpenAI is set up. */
  web?: { searches: number; fetches: number }
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface Generated<T> {
  answer: T
  /** Whether Claude's web tools were offered. */
  web: boolean
  model: string
}

/** One answer from the model. Throws AiUnavailable or AiFailed. */
export async function generate<S extends ZodRawShape>(opts: GenerateOptions<S>): Promise<Generated<z.infer<z.ZodObject<S>>>> {
  const { adapter, model, effort } = pick()
  let apiKey: string
  try {
    apiKey = adapter.requireKey()
  } catch (err: any) {
    throw new AiUnavailable(err.message)
  }
  const schema = z.object(opts.answer.input)
  const tool: CopilotTool<S> = {
    ...opts.answer,
    target: 'server',
    readOnly: true,
    // Never run: the call's arguments are the answer.
    handler: async () => null,
  }
  const web = !!opts.web && adapter === anthropicAdapter
  const serverTools: CallOptions['serverTools'] = web
    ? [
        { type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: opts.web!.searches },
        { type: WEB_FETCH_TOOL, name: 'web_fetch', max_uses: opts.web!.fetches, max_content_tokens: 10_000 },
      ]
    : undefined
  const items: unknown[] = [adapter.textItem('user', opts.prompt)]
  const signal = AbortSignal.any([opts.signal ?? new AbortController().signal, AbortSignal.timeout(TIMEOUT_MS)])

  for (let n = 0; n < MAX_CALLS; n++) {
    const result = await adapter.call({
      apiKey,
      model,
      effort,
      system: opts.system,
      items,
      tools: [tool],
      serverTools,
      maxTokens: GENERATE_MAX_TOKENS,
      signal,
      fetchImpl: opts.fetchImpl ?? fetch,
    })
    if (!result.ok) throw result.fatal ? new AiUnavailable(result.message) : new AiFailed(result.message)
    items.push(...result.items)
    if (result.paused) continue

    if (result.calls.length) {
      for (const call of result.calls) {
        const parsed = call.name === tool.name ? schema.safeParse(call.args) : null
        if (parsed?.success) return { answer: parsed.data, web, model }
      }
      // Every call gets a result back, or the next request is refused.
      const why = (call: ToolCall) => {
        const parsed = call.name === tool.name ? schema.safeParse(call.args) : null
        return parsed && !parsed.success ? `Invalid answer:\n${z.prettifyError(parsed.error)}\nCall ${tool.name} again with it fixed.` : `There is no tool called ${call.name}. Answer with ${tool.name}.`
      }
      items.push(...adapter.toolResultItems(result.calls.map((call) => ({ call, outcome: { isError: true, content: [{ type: 'text' as const, text: why(call) }] } }))))
      continue
    }
    if (result.incomplete) throw new AiFailed(`The answer was cut short (${result.incomplete}).`)
    items.push(adapter.textItem('user', `Give your answer by calling the ${tool.name} tool.`))
  }
  throw new AiFailed("The AI didn't give an answer.")
}
