import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let storedChat: { messages: Array<{ role: string; content: string; isError?: boolean }> } | null = null
vi.mock('../db', () => ({
  db: {
    getCopilotSettings: () => null,
    getCopilotChat: () => storedChat,
    getBrandKit: () => null,
  },
}))
const createList = vi.fn(async (name: string) => ({ id: 7, name }))
vi.mock('../emailService', () => ({
  getLists: async () => ({ lists: [{ id: 3, name: 'Newsletter', totalContacts: 12, createdAt: '2026-01-01' }] }),
  createList: (name: string) => createList(name),
}))

const { runTurn, toolSchema } = await import('./agent')
const { openaiAdapter } = await import('./providers/openai')
const { anthropicAdapter } = await import('./providers/anthropic')
const runOpenAITurn = (turn: Parameters<typeof runTurn>[1], fetchImpl: typeof fetch) => runTurn(openaiAdapter, turn, fetchImpl)
const runClaudeTurn = (turn: Parameters<typeof runTurn>[1], fetchImpl: typeof fetch) => runTurn(anthropicAdapter, turn, fetchImpl)
const { createSession, subscribeSession } = await import('./state')
const { COPILOT_TOOLS } = await import('./tools')

const original = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY }
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-proj-testkey0000000000000000'
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-testkey000000000000000000'
  storedChat = null
  createList.mockClear()
})
afterEach(() => {
  if (original.openai === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = original.openai
  if (original.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = original.anthropic
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const message = (text: string) => ({ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const call = (name: string, args: unknown, callId = 'call_1') => ({ id: 'fc_1', type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) })

/** A fake OpenAI that answers each request with the next canned response. */
function fakeOpenAI(...responses: Response[]) {
  const bodies: any[] = []
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return responses.shift() ?? json({ output: [message('(no more canned responses)')] })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies }
}

function newChat(mode: 'ask' | 'auto-safe' | 'bypass' = 'auto-safe') {
  const session = createSession()
  session.permissionMode = mode
  const events: any[] = []
  subscribeSession(session.id, (e) => events.push(e))
  return { session, events }
}

describe('copilot on OpenAI', () => {
  it('offers every copilot tool as an OpenAI function', async () => {
    const { session } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(json({ output: [message('Hi')] }))
    await runOpenAITurn({ sessionId: session.id, message: 'Hi' }, fetchImpl)
    const tools = bodies[0].tools as any[]
    expect(tools).toHaveLength(COPILOT_TOOLS.length)
    const createListTool = tools.find((t) => t.name === 'createList')
    expect(createListTool).toMatchObject({ type: 'function', parameters: { type: 'object', required: ['name'] } })
    expect(createListTool.parameters.$schema).toBeUndefined()
    // Every tool's schema converts, including the design tools.
    for (const tool of COPILOT_TOOLS) expect(toolSchema(tool)).toMatchObject({ type: 'object' })
  })

  it('runs tool calls in-process and sends their results back', async () => {
    const { session, events } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(json({ output: [call('getLists', {})] }), json({ output: [message('You have one list: Newsletter.')] }))

    await runOpenAITurn({ sessionId: session.id, message: 'What lists do I have?' }, fetchImpl)

    expect(events.map((e) => e.type)).toEqual(['session', 'tool_start', 'tool_result', 'text', 'done'])
    expect(events.at(-1)).toMatchObject({ type: 'done', text: 'You have one list: Newsletter.' })
    expect(bodies[0]).toMatchObject({ model: 'gpt-6-sol', store: false, include: ['reasoning.encrypted_content'] })
    expect(bodies[0].input).toEqual([{ role: 'user', content: 'What lists do I have?' }])
    // The second request carries the call (without its unreplayable id) and its output.
    const [, sentCall, output] = bodies[1].input
    expect(sentCall).toMatchObject({ type: 'function_call', call_id: 'call_1', name: 'getLists' })
    expect(sentCall.id).toBeUndefined()
    expect(output).toMatchObject({ type: 'function_call_output', call_id: 'call_1' })
    expect(output.output).toContain('Newsletter')
  })

  it('passes the model and reasoning effort through', async () => {
    const { session } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(json({ output: [message('Hi')] }))
    await runOpenAITurn({ sessionId: session.id, message: 'Hi', model: 'gpt-6-astra', effort: 'xhigh' }, fetchImpl)
    expect(bodies[0]).toMatchObject({ model: 'gpt-6-astra', reasoning: { effort: 'xhigh' } })
  })

  it('rejects invalid arguments before the tool runs, and lets the model correct itself', async () => {
    const { session, events } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(json({ output: [call('createList', {})] }), json({ output: [message('What should it be called?')] }))
    await runOpenAITurn({ sessionId: session.id, message: 'Make a list' }, fetchImpl)
    expect(createList).not.toHaveBeenCalled()
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ isError: true, preview: expect.stringMatching(/invalid arguments/) })
    expect(bodies[1].input.at(-1).output).toMatch(/invalid arguments/)
  })

  it('asks before a change in "Always ask" mode, and a decline stops the tool', async () => {
    const { session, events } = newChat('ask')
    // Decline as soon as the approval prompt arrives.
    subscribeSession(session.id, (e: any) => {
      if (e.type === 'permission_request') queueMicrotask(() => session.pendingApprovals.get(e.id)?.(false))
    })
    const { fetchImpl } = fakeOpenAI(json({ output: [call('createList', { name: 'VIPs' })] }), json({ output: [message('OK, I won\'t.')] }))
    await runOpenAITurn({ sessionId: session.id, message: 'Make a VIPs list' }, fetchImpl)
    expect(events.map((e) => e.type)).toContain('permission_request')
    expect(createList).not.toHaveBeenCalled()
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ isError: true, preview: expect.stringMatching(/declined/) })
  })

  it('explains a rejected key and forgets the failed turn', async () => {
    const { session, events } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(json({ error: { message: 'Incorrect API key' } }, 401), json({ output: [message('Hello again')] }))
    await runOpenAITurn({ sessionId: session.id, message: 'First try' }, fetchImpl)
    expect(events.at(-1)).toMatchObject({ type: 'error', fatal: true, message: expect.stringMatching(/rejected the copilot's API key/) })
    await runOpenAITurn({ sessionId: session.id, message: 'Second try' }, fetchImpl)
    expect(bodies[1].input).toEqual([{ role: 'user', content: 'Second try' }])
  })

  it('says when the account is out of credit', async () => {
    const { session, events } = newChat()
    const { fetchImpl } = fakeOpenAI(json({ error: { code: 'insufficient_quota', message: 'quota' } }, 429))
    await runOpenAITurn({ sessionId: session.id, message: 'Hi' }, fetchImpl)
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/run out of credit/) })
  })

  it('picks up a saved chat from its transcript', async () => {
    storedChat = {
      messages: [
        { role: 'user', content: 'Find me CFOs in Leeds' },
        { role: 'assistant', content: 'Found 5.' },
        { role: 'assistant', content: 'Something broke', isError: true },
      ],
    }
    const { session } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(json({ output: [message('Sure')] }))
    await runOpenAITurn({ sessionId: session.id, message: 'Now in York' }, fetchImpl)
    expect(bodies[0].input).toEqual([
      { role: 'user', content: 'Find me CFOs in Leeds' },
      { role: 'assistant', content: 'Found 5.' },
      { role: 'user', content: 'Now in York' },
    ])
  })

  it('needs an OpenAI key', async () => {
    delete process.env.OPENAI_API_KEY
    const { session, events } = newChat()
    const { fetchImpl } = fakeOpenAI()
    await runOpenAITurn({ sessionId: session.id, message: 'Hi' }, fetchImpl)
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/OpenAI API key.*Settings → Copilot/) })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

const claudeMessage = (content: unknown[], stop_reason = 'end_turn') => json({ id: 'msg_1', type: 'message', role: 'assistant', content, stop_reason })

describe('copilot on Claude', () => {
  it('runs tool calls and sends every result back in one user message', async () => {
    const { session, events } = newChat()
    const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' }
    const { fetchImpl, bodies } = fakeOpenAI(
      claudeMessage([thinking, { type: 'tool_use', id: 'toolu_1', name: 'getLists', input: {} }], 'tool_use'),
      claudeMessage([{ type: 'text', text: 'You have one list: Newsletter.' }]),
    )
    await runClaudeTurn({ sessionId: session.id, message: 'What lists do I have?' }, fetchImpl)

    expect(events.map((e) => e.type)).toEqual(['session', 'tool_start', 'tool_result', 'text', 'done'])
    expect(bodies[0]).toMatchObject({ model: 'claude-opus-5-5' })
    expect(bodies[0].tools.find((t: any) => t.name === 'createList')).toMatchObject({ input_schema: { type: 'object', required: ['name'] } })
    const [, assistant, results] = bodies[1].messages
    // The reply goes back unchanged, thinking signature included.
    expect(assistant).toEqual({ role: 'assistant', content: [thinking, { type: 'tool_use', id: 'toolu_1', name: 'getLists', input: {} }] })
    expect(results.role).toBe('user')
    expect(results.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
    expect(JSON.stringify(results.content[0].content)).toContain('Newsletter')
  })

  it('caches the prompt, tools and history without storing the cache markers', async () => {
    const { session } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(claudeMessage([{ type: 'text', text: 'Hi' }]), claudeMessage([{ type: 'text', text: 'Again' }]))
    await runClaudeTurn({ sessionId: session.id, message: 'Hello' }, fetchImpl)
    await runClaudeTurn({ sessionId: session.id, message: 'Hello again' }, fetchImpl)
    expect(bodies[0].system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(bodies[0].tools.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    expect(bodies[1].messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    // Earlier messages carry no marker (only four are allowed per request).
    expect(JSON.stringify(bodies[1].messages.slice(0, -1))).not.toContain('cache_control')
  })

  it('sends effort, except to Haiku, which has none', async () => {
    const { session } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(claudeMessage([{ type: 'text', text: 'a' }]), claudeMessage([{ type: 'text', text: 'b' }]))
    await runClaudeTurn({ sessionId: session.id, message: 'Hi', model: 'claude-sonnet-5', effort: 'xhigh' }, fetchImpl)
    await runClaudeTurn({ sessionId: session.id, message: 'Hi', model: 'claude-haiku-4-5', effort: 'high' }, fetchImpl)
    expect(bodies[0]).toMatchObject({ model: 'claude-sonnet-5', output_config: { effort: 'xhigh' } })
    expect(bodies[1].output_config).toBeUndefined()
  })

  it('marks a failed tool result as an error for Claude', async () => {
    const { session } = newChat()
    const { fetchImpl, bodies } = fakeOpenAI(
      claudeMessage([{ type: 'tool_use', id: 'toolu_1', name: 'createList', input: {} }], 'tool_use'),
      claudeMessage([{ type: 'text', text: 'What should it be called?' }]),
    )
    await runClaudeTurn({ sessionId: session.id, message: 'Make a list' }, fetchImpl)
    expect(bodies[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', is_error: true })
  })

  it('explains a rejected key', async () => {
    const { session, events } = newChat()
    const { fetchImpl } = fakeOpenAI(json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401))
    await runClaudeTurn({ sessionId: session.id, message: 'Hi' }, fetchImpl)
    expect(events.at(-1)).toMatchObject({ type: 'error', fatal: true, message: expect.stringMatching(/Anthropic rejected/) })
  })

  it('keeps separate conversations per provider, each rebuilt from the saved chat', async () => {
    storedChat = { messages: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }] }
    const { session } = newChat()
    const claude = fakeOpenAI(claudeMessage([{ type: 'text', text: 'From Claude' }]))
    await runClaudeTurn({ sessionId: session.id, message: 'Now with Claude' }, claude.fetchImpl)
    expect(claude.bodies[0].messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user'])
    const openai = fakeOpenAI(json({ output: [message('From GPT')] }))
    await runOpenAITurn({ sessionId: session.id, message: 'Now with GPT' }, openai.fetchImpl)
    expect(openai.bodies[0].input[0]).toEqual({ role: 'user', content: 'Earlier question' })
  })

  it('frees the conversation when the chat ends', async () => {
    const { endSession } = await import('./state')
    const { isTurnRunning } = await import('./agent')
    const { session } = newChat()
    let release: (r: Response) => void = () => {}
    const pending = new Promise<Response>((r) => (release = r))
    const fetchImpl = vi.fn(() => pending) as unknown as typeof fetch
    const turn = runClaudeTurn({ sessionId: session.id, message: 'Hi' }, fetchImpl)
    expect(isTurnRunning(session.id)).toBe(true)
    endSession(session.id)
    expect(isTurnRunning(session.id)).toBe(false)
    release(new Response('{}'))
    await turn
  })
})
