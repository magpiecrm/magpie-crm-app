// OpenAI models (GPT-6) through the Responses API, with the user's own OpenAI
// API key. Requests use `store: false`, so OpenAI doesn't keep the
// conversation (beyond its standard abuse-monitoring retention); reasoning is
// passed back encrypted instead.

import { errorBody, toolSchema, type ModelAdapter, type ToolCall } from '../agent'
import { requireOpenAIKey } from '../settings'
import type { ToolOutcome } from '../mcp'

const API_URL = 'https://api.openai.com/v1/responses'
const EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max'])

/** A sent item without the id OpenAI gave it: with `store: false` ids can't be referred back to. */
function replayable(item: any): any {
  if (item?.type === 'message' || item?.type === 'function_call') {
    const { id: _id, ...rest } = item
    return rest
  }
  return item
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
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

export const openaiAdapter: ModelAdapter = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: 'gpt-6.1-sol',
  requireKey: requireOpenAIKey,
  textItem: (role, text) => ({ role, content: text }),

  async call({ apiKey, model, effort, system, items, tools, signal, fetchImpl }) {
    const res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: system,
        input: items,
        tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: toolSchema(t), strict: false })),
        store: false,
        include: ['reasoning.encrypted_content'],
        ...(effort && EFFORTS.has(effort) ? { reasoning: { effort } } : {}),
      }),
      signal,
    })
    if (!res.ok) {
      const error = await errorBody(res)
      if (res.status === 401) return { ok: false, fatal: true, message: 'OpenAI rejected the copilot\'s API key. Check it in Settings → Copilot.' }
      if (res.status === 403) return { ok: false, fatal: true, message: 'This OpenAI API key isn\'t allowed to use this model or the API. Check its project and permissions on the OpenAI platform.' }
      if (error?.code === 'insufficient_quota') return { ok: false, fatal: true, message: 'The OpenAI account behind this key has run out of credit. Add some on the OpenAI platform.' }
      if (error?.code === 'model_not_found' || res.status === 404) return { ok: false, fatal: true, message: `OpenAI doesn't offer the model "${model}" to this key. Pick another model.` }
      if (res.status === 429) return { ok: false, message: 'OpenAI is rate-limiting this key. Try again in a minute.' }
      return { ok: false, message: `OpenAI returned HTTP ${res.status}${error?.message ? `: ${error.message}` : '.'}` }
    }

    const json: any = await res.json()
    const output: any[] = json.output ?? []
    const texts: string[] = []
    const calls: ToolCall[] = []
    for (const item of output) {
      if (item.type === 'message') {
        const text = (item.content ?? []).filter((c: any) => c.type === 'output_text' && c.text).map((c: any) => c.text).join('')
        if (text) texts.push(text)
      } else if (item.type === 'function_call') {
        calls.push({ id: item.call_id, name: item.name, args: parseArgs(item.arguments) })
      }
    }
    return {
      ok: true,
      items: output.map(replayable),
      texts,
      calls,
      incomplete: json.status === 'incomplete' ? (json.incomplete_details?.reason ?? 'incomplete') : undefined,
    }
  },

  toolResultItems: (results) =>
    results.map(({ call, outcome }) => ({ type: 'function_call_output', call_id: call.id, output: toolOutput(outcome) })),
}
