import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'

// One-shot answers from the model (generate.ts): which model and key it runs
// on, Claude's web tools only when asked, and the answer read from its tool.

const scratchDir = mkdtempSync(join(tmpdir(), 'generate-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { generate, AiFailed, AiUnavailable, aiAvailable, GENERATE_MODEL } = await import('./generate')
const { MANAGED_MODEL } = await import('./managedAi')

const ENV = ['COPILOT_MANAGED', 'REACHER_URL', 'REACHER_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const
const original = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
beforeEach(() => {
  for (const k of ENV) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
const claude = (content: unknown[], stop_reason = 'tool_use') => json({ id: 'msg', type: 'message', role: 'assistant', content, stop_reason }, { 'x-magpie-ai-charge': '10' })
const answer = (input: unknown) => claude([{ type: 'tool_use', id: 'tu_1', name: 'giveColour', input }])

function fake(...responses: Response[]) {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return responses.shift() ?? claude([{ type: 'text', text: '(no more)' }], 'end_turn')
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const ask = (fetchImpl: typeof fetch, web?: { searches: number; fetches: number }) =>
  generate({
    system: 'Answer.',
    prompt: 'What colour is the sky?',
    answer: { name: 'giveColour', description: 'The answer.', input: { colour: z.string() } },
    web,
    fetchImpl,
  })

describe('generate', () => {
  it("runs on the host's AI where it runs the copilot, with Claude's web tools when asked", async () => {
    process.env.COPILOT_MANAGED = 'on'
    process.env.REACHER_URL = 'https://services.host.test'
    process.env.REACHER_SECRET = 'vt_secret'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-owncopykey000000000000'
    expect(aiAvailable()).toEqual({ ok: true, web: true })
    const { fetchImpl, calls } = fake(answer({ colour: 'blue' }))
    expect(await ask(fetchImpl, { searches: 3, fetches: 2 })).toMatchObject({ answer: { colour: 'blue' }, web: true, model: MANAGED_MODEL })
    expect(calls[0].url).toBe('https://services.host.test/v1/ai/messages')
    expect(calls[0].body.model).toBe(MANAGED_MODEL)
    expect(calls[0].body.tools.map((t: any) => t.type ?? t.name)).toEqual(['giveColour', 'web_search_20250305', 'web_fetch_20250910'])
    expect(calls[0].body.tools[1]).toMatchObject({ name: 'web_search', max_uses: 3 })
    expect(calls[0].body.tools[2]).toMatchObject({ name: 'web_fetch', max_uses: 2 })
  })

  it("uses this copy's own Anthropic key with Haiku 5.5 at effort max, and no web tools unless asked", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-owncopykey000000000000'
    const { fetchImpl, calls } = fake(answer({ colour: 'blue' }))
    await ask(fetchImpl)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].body).toMatchObject({ model: GENERATE_MODEL, output_config: { effort: 'max' } })
    expect(calls[0].body.tools.map((t: any) => t.name)).toEqual(['giveColour'])
  })

  it('carries on a paused web turn, and asks again for an answer it can read', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-owncopykey000000000000'
    const { fetchImpl, calls } = fake(
      claude([{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'sky' } }], 'pause_turn'),
      answer({ colour: 7 }),
      answer({ colour: 'blue' }),
    )
    expect((await ask(fetchImpl, { searches: 1, fetches: 1 })).answer).toEqual({ colour: 'blue' })
    expect(calls).toHaveLength(3)
    // Continued with Claude's own turn last, then the bad answer handed back as an error.
    expect(calls[1].body.messages.at(-1)).toMatchObject({ role: 'assistant' })
    expect(calls[2].body.messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true })
  })

  it('falls back to OpenAI without web tools, and says when there is no AI at all', async () => {
    expect(aiAvailable()).toMatchObject({ ok: false })
    await expect(ask(fake().fetchImpl)).rejects.toBeInstanceOf(AiUnavailable)

    process.env.OPENAI_API_KEY = 'sk-proj-openaikey00000000000000000000'
    expect(aiAvailable()).toEqual({ ok: true, web: false })
    const { fetchImpl, calls } = fake(json({ status: 'completed', output: [{ type: 'function_call', call_id: 'c1', name: 'giveColour', arguments: '{"colour":"blue"}' }] }))
    expect(await ask(fetchImpl, { searches: 3, fetches: 2 })).toMatchObject({ answer: { colour: 'blue' }, web: false })
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses')
    expect(calls[0].body.tools).toHaveLength(1)
  })

  it('gives up on a model that never answers with the tool, and on errors', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-owncopykey000000000000'
    await expect(ask(fake().fetchImpl)).rejects.toBeInstanceOf(AiFailed)
    const refused = new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } }), { status: 401 })
    await expect(ask(fake(refused).fetchImpl)).rejects.toBeInstanceOf(AiUnavailable)
    const busy = new Response(JSON.stringify({ error: { type: 'rate_limit_error' } }), { status: 429 })
    await expect(ask(fake(busy).fetchImpl)).rejects.toBeInstanceOf(AiFailed)
  })
})
