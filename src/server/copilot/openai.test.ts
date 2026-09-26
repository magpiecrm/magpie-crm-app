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

const { runOpenAITurn, openAITools } = await import('./openai')
const { createSession, subscribeSession } = await import('./state')
const { COPILOT_TOOLS } = await import('./tools')

const original = process.env.OPENAI_API_KEY
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-proj-testkey0000000000000000'
  storedChat = null
  createList.mockClear()
})
afterEach(() => {
  if (original === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = original
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

describe('OpenAI copilot', () => {
  it('offers every copilot tool as an OpenAI function', () => {
    const tools = openAITools() as any[]
    expect(tools).toHaveLength(COPILOT_TOOLS.length)
    const createListTool = tools.find((t) => t.name === 'createList')
    expect(createListTool).toMatchObject({ type: 'function', parameters: { type: 'object', required: ['name'] } })
    expect(createListTool.parameters.$schema).toBeUndefined()
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
