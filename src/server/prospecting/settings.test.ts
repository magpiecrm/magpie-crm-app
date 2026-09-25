import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProspectingSettingsRecord } from '../db'

// Settings live in the JSON db; an in-memory stand-in keeps the real file
// untouched.
let stored: ProspectingSettingsRecord | null = null
vi.mock('../db', () => ({
  db: {
    getProspectingSettings: () => stored,
    saveProspectingSettings: (next: ProspectingSettingsRecord) => {
      stored = next
    },
  },
}))

const settings = await import('./settings')

const ENV_KEYS = ['SOCIALFETCH_API_KEY', 'REACHER_URL', 'REACHER_SECRET'] as const
const original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(() => {
  stored = null
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('SocialFetch key', () => {
  it('explains where to add a key when none is set', () => {
    expect(settings.isSocialFetchConfigured()).toBe(false)
    expect(() => settings.requireSocialFetchKey()).toThrow(/Settings → Prospecting/)
  })

  it('stores the key encrypted and uses it', () => {
    settings.saveProspectingSettings({ socialfetchApiKey: '  sfk_live_secret1234  ' })
    expect(JSON.stringify(stored)).not.toContain('sfk_live_secret1234')
    expect(settings.requireSocialFetchKey()).toBe('sfk_live_secret1234')
  })

  it('prefers a saved key over the env var, and falls back when it is removed', () => {
    process.env.SOCIALFETCH_API_KEY = 'sfk_from_env_0000'
    expect(settings.getMaskedProspectingSettings().socialfetch).toEqual({ isSet: true, hint: '…0000', source: 'env' })

    settings.saveProspectingSettings({ socialfetchApiKey: 'sfk_saved_9999' })
    expect(settings.requireSocialFetchKey()).toBe('sfk_saved_9999')

    settings.saveProspectingSettings({ clear: ['socialfetchApiKey'] })
    expect(settings.requireSocialFetchKey()).toBe('sfk_from_env_0000')
  })

  it('keeps the saved key when the form submits a blank one', () => {
    settings.saveProspectingSettings({ socialfetchApiKey: 'sfk_keep_me_1111' })
    settings.saveProspectingSettings({ socialfetchApiKey: '', reacherUrl: 'http://reacher:8080' })
    expect(settings.requireSocialFetchKey()).toBe('sfk_keep_me_1111')
  })

  it('refuses values that are not SocialFetch keys, keeping the saved one', () => {
    settings.saveProspectingSettings({ socialfetchApiKey: 'sfk_real_2222' })
    expect(() => settings.saveProspectingSettings({ socialfetchApiKey: 'localhost:3211/collection/prospect-search' })).toThrow(/sfk_/)
    expect(() => settings.saveProspectingSettings({ socialfetchApiKey: 'hunter2' })).toThrow(/sfk_/)
    expect(settings.requireSocialFetchKey()).toBe('sfk_real_2222')
  })

  it('never returns the key itself, only the last four characters', () => {
    settings.saveProspectingSettings({ socialfetchApiKey: 'sfk_abcdefgh5678', reacherSecret: 'reacher-secret' })
    const masked = JSON.stringify(settings.getMaskedProspectingSettings())
    expect(masked).not.toContain('sfk_abcdefgh5678')
    expect(masked).not.toContain('reacher-secret')
    expect(masked).toContain('…5678')
  })
})

describe('Reacher config', () => {
  it('is off until a URL is set', () => {
    expect(settings.getReacherConfig()).toBeNull()
  })

  it('combines saved values with env fallbacks and trims the URL', () => {
    process.env.REACHER_SECRET = 'env-secret'
    settings.saveProspectingSettings({ reacherUrl: 'http://reacher:8080/', reacherHelloName: 'mail.acme.com' })
    expect(settings.getReacherConfig()).toEqual({
      url: 'http://reacher:8080',
      secret: 'env-secret',
      fromEmail: undefined,
      helloName: 'mail.acme.com',
    })
  })

  it('rejects a URL without a scheme', () => {
    expect(() => settings.saveProspectingSettings({ reacherUrl: 'reacher:8080' })).toThrow(/http/)
  })

  it('validates the FROM address and HELO name', () => {
    expect(() => settings.saveProspectingSettings({ reacherFromEmail: 'not-an-email' })).toThrow(/email/)
    expect(() => settings.saveProspectingSettings({ reacherHelloName: 'mail.example.comlocalhost:3211/x' })).toThrow(/hostname/)
    settings.saveProspectingSettings({ reacherFromEmail: 'verify@acme.com', reacherHelloName: 'mail.acme.com' })
    expect(stored).toMatchObject({ reacher_from_email: 'verify@acme.com', reacher_hello_name: 'mail.acme.com' })
  })
})
