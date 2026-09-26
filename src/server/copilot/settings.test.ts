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
const original = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  stored = null
  delete process.env.ANTHROPIC_API_KEY
})
afterEach(() => {
  if (original === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = original
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
})
