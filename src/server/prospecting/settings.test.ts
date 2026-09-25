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

const ENV_KEYS = ['SOCIALFETCH_API_KEY', 'REACHER_URL', 'REACHER_SECRET', 'NEVERBOUNCE_API_KEY'] as const
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

  it('picks whatever is configured when nothing was chosen, Reacher first', () => {
    settings.saveProspectingSettings({ neverbounceApiKey: 'secret_nb_key_1234567890' })
    expect(settings.getActiveVerifier()).toEqual({ provider: 'neverbounce', apiKey: 'secret_nb_key_1234567890', fallback: null })
    settings.saveProspectingSettings({ reacherUrl: 'http://reacher:8080' })
    expect(settings.getActiveVerifier()?.provider).toBe('reacher')
  })

  it('honours an explicit choice, and never silently falls back to the other service', () => {
    settings.saveProspectingSettings({ reacherUrl: 'http://reacher:8080', verificationProvider: 'neverbounce' })
    expect(settings.getActiveVerifier()).toBeNull()
    settings.saveProspectingSettings({ neverbounceApiKey: 'secret_nb_key_1234567890' })
    expect(settings.getActiveVerifier()?.provider).toBe('neverbounce')
    settings.saveProspectingSettings({ verificationProvider: 'none' })
    expect(settings.getActiveVerifier()).toBeNull()
  })

  it('adds Reacher as a fallback for NeverBounce only when asked and configured', () => {
    settings.saveProspectingSettings({ verificationProvider: 'neverbounce', neverbounceApiKey: 'secret_nb_key_1234567890' })
    expect(settings.getActiveVerifier()).toMatchObject({ provider: 'neverbounce', fallback: null })
    settings.saveProspectingSettings({ reacherFallback: true })
    expect(settings.getActiveVerifier()).toMatchObject({ fallback: null })
    settings.saveProspectingSettings({ reacherUrl: 'http://reacher:8080' })
    expect(settings.getActiveVerifier()).toMatchObject({ provider: 'neverbounce', fallback: { url: 'http://reacher:8080' } })
    expect(settings.getMaskedProspectingSettings().verification.reacherFallback).toBe(true)
  })

  it('stores the NeverBounce key encrypted, masks it, and can remove it', () => {
    settings.saveProspectingSettings({ neverbounceApiKey: 'secret_nb_key_abcd9876' })
    expect(JSON.stringify(stored)).not.toContain('secret_nb_key_abcd9876')
    const masked = settings.getMaskedProspectingSettings()
    expect(masked.neverbounce).toEqual({ isSet: true, hint: '…9876', source: 'db' })
    expect(JSON.stringify(masked)).not.toContain('secret_nb_key_abcd9876')
    settings.saveProspectingSettings({ clear: ['neverbounceApiKey'] })
    expect(settings.getMaskedProspectingSettings().neverbounce.isSet).toBe(false)
  })

  it('falls back to NEVERBOUNCE_API_KEY and rejects obviously wrong keys', () => {
    process.env.NEVERBOUNCE_API_KEY = 'secret_from_env_12345678'
    expect(settings.getActiveVerifier()).toEqual({ provider: 'neverbounce', apiKey: 'secret_from_env_12345678', fallback: null })
    expect(() => settings.saveProspectingSettings({ neverbounceApiKey: 'short' })).toThrow(/NeverBounce/)
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
