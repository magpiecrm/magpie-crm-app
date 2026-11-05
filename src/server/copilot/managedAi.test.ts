import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'managed-ai-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { runTurn } = await import('./agent')
const { anthropicAdapter } = await import('./providers/anthropic')
const { listProviders } = await import('./providers')
const { sendTurn } = await import('./session')
const { saveCopilotSettings } = await import('./settings')
const { createSession, subscribeSession } = await import('./state')
const { aiBudgetUsed, clearAllowance, getAllowance, setAllowance } = await import('../allowance')

const ENV = ['COPILOT_MANAGED', 'REACHER_URL', 'REACHER_SECRET', 'ANTHROPIC_API_KEY'] as const
const original = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
beforeEach(() => {
  process.env.COPILOT_MANAGED = 'on'
  process.env.REACHER_URL = 'https://services.host.test/'
  process.env.REACHER_SECRET = 'vt_mc_secret'
  // A key of the copy's own is never used where the host runs the copilot.
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-owncopykey000000000000'
})
afterEach(() => {
  clearAllowance()
  vi.unstubAllGlobals()
  for (const k of ENV) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const period = { periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z', upgradeUrl: null }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const reply = (text: string, charge = 1200) =>
  json({ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' }, 200, { 'x-magpie-ai-charge': String(charge) })

/** A fake host answering each request with the next canned response. */
function fakeHost(...responses: Response[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return responses.shift() ?? reply('(no more canned responses)')
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function newChat() {
  const session = createSession()
  session.permissionMode = 'auto-safe'
  const events: any[] = []
  subscribeSession(session.id, (e) => events.push(e))
  return { session, events }
}

describe('copilot on the host’s AI', () => {
  it('asks the host with this copy’s secret, as Maggy, and counts the charge against the AI budget', async () => {
    setAllowance({ ...period, ai: 10_000 })
    const { session, events } = newChat()
    const { fetchImpl, calls } = fakeHost(reply('Hello there', 1234))
    await runTurn(anthropicAdapter, { sessionId: session.id, message: 'Hi', model: 'claude-haiku-5-5', effort: 'max' }, fetchImpl)

    expect(events.at(-1)).toMatchObject({ type: 'done', text: 'Hello there' })
    expect(calls[0].url).toBe('https://services.host.test/v1/ai/messages')
    expect(calls[0].headers['x-reacher-secret']).toBe('vt_mc_secret')
    expect(calls[0].headers['x-api-key']).toBeUndefined()
    expect(calls[0].body).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'max' } })
    expect(calls[0].body.system[0].text).toContain('Your name is Maggy')
    expect(getAllowance()!.used.ai).toBe(1234)
    expect(aiBudgetUsed(getAllowance()!)).toMatchObject({ percent: 12 })
  })

  it('runs Maggy whatever model and provider the chat asked for', async () => {
    const { session, events } = newChat()
    const { fetchImpl, calls } = fakeHost(reply('Done'))
    vi.stubGlobal('fetch', fetchImpl)
    const finished = new Promise<void>((resolve) => subscribeSession(session.id, (e) => e.type === 'done' && resolve()))
    sendTurn({ sessionId: session.id, providerId: 'openai', message: 'Hi', model: 'gpt-6-astra', effort: 'low' })
    await finished
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect(calls[0].body).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'max' } })
  })

  it('stops before asking once the AI budget is used up', async () => {
    setAllowance({ ...period, ai: 1000 })
    const { session, events } = newChat()
    const { fetchImpl } = fakeHost(reply('First', 1000))
    await runTurn(anthropicAdapter, { sessionId: session.id, message: 'Hi' }, fetchImpl)
    await runTurn(anthropicAdapter, { sessionId: session.id, message: 'Again' }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ type: 'error', fatal: true, message: expect.stringMatching(/used this month's AI budget/) })
  })

  it('says what the host refused, in words for the chat', async () => {
    const { session, events } = newChat()
    const { fetchImpl } = fakeHost(
      json({ error: 'No AI budget.', code: 'no_budget' }, 402),
      json({ error: 'Used.', code: 'budget_used' }, 402),
      json({ error: 'Too many.' }, 429),
      json({ error: 'Suspended.', code: 'suspended' }, 403),
    )
    for (let i = 0; i < 4; i++) await runTurn(anthropicAdapter, { sessionId: session.id, message: 'Hi' }, fetchImpl)
    const errors = events.filter((e) => e.type === 'error')
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/no AI budget.*Plan and billing/),
      expect.stringMatching(/used this month's AI budget/),
      expect.stringMatching(/busy/),
      expect.stringMatching(/isn't available on this workspace/),
    ])
    expect(errors.map((e) => Boolean(e.fatal))).toEqual([true, true, false, true])
  })

  it('needs the host to have set it up', async () => {
    delete process.env.REACHER_SECRET
    const { session, events } = newChat()
    const { fetchImpl } = fakeHost()
    await runTurn(anthropicAdapter, { sessionId: session.id, message: 'Hi' }, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'error', fatal: true, message: expect.stringMatching(/isn't set up/) })
  })

  it('offers only Maggy, and takes no keys', () => {
    expect(listProviders()).toEqual([{ id: 'claude', label: 'Maggy', keySet: true }])
    expect(() => saveCopilotSettings({ anthropicApiKey: 'sk-ant-api03-anotherkey00000000000000' })).toThrow(/takes no API keys/)
  })
})
