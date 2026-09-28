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

// Every env var the settings read, so a developer's own .env can't leak in.
const ENV_KEYS = [
  'SOCIALFETCH_API_KEY',
  'REACHER_URL',
  'REACHER_SECRET',
  'REACHER_FROM_EMAIL',
  'REACHER_HELLO_NAME',
  'REACHER_PROXIES',
  'NEVERBOUNCE_API_KEY',
] as const
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
    expect(() => settings.requireSocialFetchKey()).toThrow(/Settings → Data source/)
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

describe('proxies', () => {
  it('stores proxies encrypted and never returns their passwords', () => {
    settings.saveProspectingSettings({ proxies: [{ host: '203.0.113.5', port: 1080, username: 'u', password: 'proxy-pass-1', label: 'eu-1' }] })
    expect(JSON.stringify(stored)).not.toContain('proxy-pass-1')
    expect(settings.getProxyConfigs().proxies).toEqual([{ host: '203.0.113.5', port: 1080, username: 'u', password: 'proxy-pass-1', label: 'eu-1' }])
    const masked = JSON.stringify(settings.getMaskedProspectingSettings())
    expect(masked).not.toContain('proxy-pass-1')
    expect(settings.getMaskedProspectingSettings().proxies.list[0]).toMatchObject({ host: '203.0.113.5', passwordSet: true })
  })

  it('keeps a saved password when the form sends it blank', () => {
    settings.saveProspectingSettings({ proxies: [{ host: 'p.example.com', port: 1080, username: 'u', password: 'keep-me' }] })
    settings.saveProspectingSettings({ proxies: [{ host: 'p.example.com', port: 1080, username: 'u', password: '', label: 'renamed' }] })
    expect(settings.getProxyConfigs().proxies[0]).toMatchObject({ password: 'keep-me', label: 'renamed' })
  })

  it('rejects bad hosts and ports', () => {
    expect(() => settings.saveProspectingSettings({ proxies: [{ host: 'not a host', port: 1080 }] })).toThrow(/Proxy 1/)
    expect(() => settings.saveProspectingSettings({ proxies: [{ host: 'p.example.com', port: 70000 }] })).toThrow(/port/)
  })

  it('leaves saved proxies alone when a save does not mention them', () => {
    settings.saveProspectingSettings({ proxies: [{ host: 'p.example.com', port: 1080 }] })
    settings.saveProspectingSettings({ reacherHelloName: 'mail.acme.com' })
    expect(settings.getProxyConfigs().proxies).toHaveLength(1)
  })
})

describe('verification provider', () => {
  it('is off when nothing is configured', () => {
    expect(settings.getActiveVerifier()).toBeNull()
  })

  it('is the verification server once it is set up, unless switched off', () => {
    settings.saveProspectingSettings({ reacherUrl: 'http://reacher:8080' })
    expect(settings.getActiveVerifier()).toMatchObject({ provider: 'reacher', reacher: { url: 'http://reacher:8080' } })
    settings.saveProspectingSettings({ verificationProvider: 'none' })
    expect(settings.getActiveVerifier()).toBeNull()
    settings.saveProspectingSettings({ verificationProvider: 'reacher' })
    expect(settings.getActiveVerifier()?.provider).toBe('reacher')
  })

  // NeverBounce was removed; settings saved before that must not break or linger.
  it('treats a leftover NeverBounce choice as automatic, and ignores its old key', async () => {
    const { encryptToken, decryptToken } = await import('../crypto')
    const { env } = await import('../env')
    process.env.NEVERBOUNCE_API_KEY = 'secret_from_env_12345678'
    stored = {
      secrets: encryptToken({ neverbounceApiKey: 'secret_old_nb_key' }, env.credentialsSecret()),
      verification_provider: 'neverbounce',
      updated_at: '2026-01-01T00:00:00Z',
    }
    expect(settings.getActiveVerifier()).toBeNull()
    expect(settings.getMaskedProspectingSettings().verification.chosen).toBeNull()

    settings.saveProspectingSettings({ reacherUrl: 'http://reacher:8080' })
    expect(settings.getActiveVerifier()?.provider).toBe('reacher')
    // The next save drops the old key (here the only secret, so nothing is left) and the old choice.
    expect(stored!.secrets).toBeUndefined()
    settings.saveProspectingSettings({ socialfetchApiKey: 'sfk_live_key_0001' })
    expect(decryptToken(stored!.secrets!, env.credentialsSecret())).toEqual({ socialfetchApiKey: 'sfk_live_key_0001' })
    expect(stored!.verification_provider).toBeUndefined()
  })
})

describe('verified only', () => {
  it('is on unless explicitly switched off', () => {
    expect(settings.isVerifiedOnly()).toBe(true)
    settings.saveProspectingSettings({ reacherHelloName: 'mail.acme.com' })
    expect(settings.isVerifiedOnly()).toBe(true)
    settings.saveProspectingSettings({ verifiedOnly: false })
    expect(settings.isVerifiedOnly()).toBe(false)
    expect(settings.getMaskedProspectingSettings().verification.verifiedOnly).toBe(false)
    settings.saveProspectingSettings({ verifiedOnly: true })
    expect(settings.isVerifiedOnly()).toBe(true)
  })
})

describe('verification server config', () => {
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
