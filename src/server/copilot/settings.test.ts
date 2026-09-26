import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let stored: { secrets?: string; updated_at: string } | null = null
vi.mock('../db', () => ({
  db: {
    getCopilotSettings: () => stored,
    saveCopilotSettings: (next: { secrets?: string; updated_at: string }) => {
      stored = next
    },
  },
}))

const settings = await import('./settings')

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
const OPENAI_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'
const original = { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY }

beforeEach(() => {
  stored = null
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
})
afterEach(() => {
  if (original.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = original.anthropic
  if (original.openai === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = original.openai
})

describe('copilot settings', () => {
  it('has no key until one is saved, and says where to add it', () => {
    expect(settings.getMaskedCopilotSettings().anthropic).toEqual({ isSet: false, hint: null, source: null })
    expect(() => settings.requireAnthropicKey()).toThrow(/Settings → Copilot/)
  })

  it('stores the key encrypted and only ever shows its last four characters', () => {
    settings.saveCopilotSettings({ anthropicApiKey: KEY })
    expect(stored?.secrets).toBeTruthy()
    expect(JSON.stringify(stored)).not.toContain(KEY)
    expect(settings.requireAnthropicKey()).toBe(KEY)
    expect(settings.getMaskedCopilotSettings().anthropic).toEqual({ isSet: true, hint: '…6789', source: 'db' })
  })

  it('rejects things that are not Anthropic keys', () => {
    expect(() => settings.saveCopilotSettings({ anthropicApiKey: 'hunter2' })).toThrow(/sk-ant-/)
    expect(() => settings.saveCopilotSettings({ anthropicApiKey: 'https://claude.ai/login' })).toThrow(/sk-ant-/)
  })

  it('falls back to ANTHROPIC_API_KEY, and a saved key wins over it', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-fromtheenvironment0000000000'
    expect(settings.getMaskedCopilotSettings().anthropic.source).toBe('env')
    settings.saveCopilotSettings({ anthropicApiKey: KEY })
    expect(settings.requireAnthropicKey()).toBe(KEY)
  })

  it('removes the saved key', () => {
    settings.saveCopilotSettings({ anthropicApiKey: KEY })
    settings.saveCopilotSettings({ clear: ['anthropicApiKey'] })
    expect(settings.getMaskedCopilotSettings().anthropic.isSet).toBe(false)
  })

  it('tests a key against Anthropic and explains a rejection', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await settings.testAnthropicKey(KEY, ok as unknown as typeof fetch)).toEqual({ ok: true })
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('api.anthropic.com/v1/models')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY)

    const rejected = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await settings.testAnthropicKey(KEY, rejected as unknown as typeof fetch)).toMatchObject({ ok: false, error: expect.stringMatching(/rejected/) })
  })

  it('keeps an OpenAI key alongside the Anthropic one', () => {
    settings.saveCopilotSettings({ anthropicApiKey: KEY })
    settings.saveCopilotSettings({ openaiApiKey: OPENAI_KEY })
    expect(JSON.stringify(stored)).not.toContain(OPENAI_KEY)
    expect(settings.requireAnthropicKey()).toBe(KEY)
    expect(settings.requireOpenAIKey()).toBe(OPENAI_KEY)
    expect(settings.getMaskedCopilotSettings().openai).toEqual({ isSet: true, hint: '…6789', source: 'db' })
    settings.saveCopilotSettings({ clear: ['openaiApiKey'] })
    expect(settings.hasKey('openaiApiKey')).toBe(false)
    expect(settings.hasKey('anthropicApiKey')).toBe(true)
  })

  it('catches a key pasted into the wrong box', () => {
    expect(() => settings.saveCopilotSettings({ openaiApiKey: KEY })).toThrow(/OpenAI API key/)
    expect(() => settings.saveCopilotSettings({ anthropicApiKey: OPENAI_KEY })).toThrow(/sk-ant-/)
    // Nothing is saved when either key is wrong.
    expect(() => settings.saveCopilotSettings({ anthropicApiKey: KEY, openaiApiKey: 'hunter2' })).toThrow()
    expect(stored).toBeNull()
  })

  it('falls back to OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'sk-proj-fromtheenvironment0000000000'
    expect(settings.getMaskedCopilotSettings().openai.source).toBe('env')
  })

  it('tests an OpenAI key against the model list', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await settings.testOpenAIKey(OPENAI_KEY, ok as unknown as typeof fetch)).toEqual({ ok: true })
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${OPENAI_KEY}`)
    const rejected = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await settings.testOpenAIKey(OPENAI_KEY, rejected as unknown as typeof fetch)).toMatchObject({ ok: false, error: expect.stringMatching(/rejected/) })
  })
})
