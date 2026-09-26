// Claude models through Anthropic's Messages API, with the user's own
// Anthropic API key (never a Claude.ai login: Anthropic's terms don't allow
// apps to offer or share one).

import { errorBody, toolSchema, type ModelAdapter, type ToolCall } from '../agent'
import { requireAnthropicKey } from '../settings'
import type { ToolOutcome } from '../mcp'

const API_URL = 'https://api.anthropic.com/v1/messages'
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
/** Haiku 4.5 predates the effort setting, and rejects it. */
const supportsEffort = (model: string) => !/haiku/i.test(model)

/** Tool output as Claude takes it: text, plus the rendered image when there is one. */
function toolContent(outcome: ToolOutcome): unknown[] {
  return outcome.content.map((c) =>
    c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } },
  )
}

/**
 * The conversation with a cache point on its last block, so each step reuses
 * the cached prefix (system prompt, tools and history) instead of paying for
 * it again. A copy: the stored conversation keeps no cache markers, since
 * only four are allowed per request.
 */
function withCachePoint(items: any[]): any[] {
  if (items.length === 0) return items
  const last = items[items.length - 1]
  const content = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content]
  content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } }
  return [...items.slice(0, -1), { ...last, content }]
}

export const anthropicAdapter: ModelAdapter = {
  id: 'claude',
  label: 'Anthropic',
  defaultModel: 'claude-opus-5-5',
  requireKey: requireAnthropicKey,
  textItem: (role, text) => ({ role, content: text }),

  async call({ apiKey, model, effort, system, items, tools, signal, fetchImpl }) {
    const toolDefs: any[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: toolSchema(t) }))
    toolDefs[toolDefs.length - 1] = { ...toolDefs[toolDefs.length - 1], cache_control: { type: 'ephemeral' } }
    const useEffort = effort && EFFORTS.has(effort) && supportsEffort(model)
    const res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: effort === 'xhigh' || effort === 'max' ? 32_000 : 16_000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: withCachePoint(items as any[]),
        tools: toolDefs,
        ...(useEffort ? { output_config: { effort } } : {}),
      }),
      signal,
    })
    if (!res.ok) {
      const error = await errorBody(res)
      if (res.status === 401) return { ok: false, fatal: true, message: 'Anthropic rejected the copilot\'s API key. Check it in Settings → Copilot.' }
      if (res.status === 403) return { ok: false, fatal: true, message: 'This Anthropic API key isn\'t allowed to use the API. Check its workspace and permissions in the Claude Console.' }
      if (res.status === 404 || error?.type === 'not_found_error') return { ok: false, fatal: true, message: `Anthropic doesn't offer the model "${model}" to this key. Pick another model.` }
      if (res.status === 400 && /credit balance/i.test(error?.message ?? '')) return { ok: false, fatal: true, message: 'The Anthropic account behind this key has run out of credit. Add some in the Claude Console.' }
      if (res.status === 429) return { ok: false, message: 'Anthropic is rate-limiting this key. Try again in a minute.' }
      if (res.status === 529) return { ok: false, message: 'Anthropic is overloaded right now. Try again in a minute.' }
      return { ok: false, message: `Anthropic returned HTTP ${res.status}${error?.message ? `: ${error.message}` : '.'}` }
    }

    const json: any = await res.json()
    const content: any[] = json.content ?? []
    const texts: string[] = []
    const calls: ToolCall[] = []
    for (const block of content) {
      if (block.type === 'text' && block.text) texts.push(block.text)
      else if (block.type === 'tool_use') calls.push({ id: block.id, name: block.name, args: block.input ?? {} })
    }
    return {
      ok: true,
      // The whole reply goes back unchanged, thinking blocks included: Claude
      // needs them (and their signatures) to continue after a tool call.
      items: [{ role: 'assistant', content }],
      texts,
      calls,
      incomplete: json.stop_reason === 'max_tokens' ? 'it hit the length limit' : undefined,
    }
  },

  // Every result for one reply goes back in a single user message.
  toolResultItems: (results) => [
    {
      role: 'user',
      content: results.map(({ call, outcome }) => ({
        type: 'tool_result',
        tool_use_id: call.id,
        content: toolContent(outcome),
        ...(outcome.isError ? { is_error: true } : {}),
      })),
    },
  ],
}
