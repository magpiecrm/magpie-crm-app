import { afterEach, describe, expect, it } from 'vitest'
import { env } from './env'

// env.ts reads process.env lazily on every call, so each test can set exactly
// the variables it needs. Everything touched here is restored afterwards so the
// suite can't leak configuration into other files.
const KEYS = [
  'NODE_ENV',
  'TRACKING_SECRET',
  'CREDENTIALS_SECRET',
  'SUBSCRIBE_ALLOWED_ORIGINS',
  'VAPID_SUBJECT',
  'AUTH_EMAIL',
] as const
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
})

const clearSecrets = () => {
  delete process.env.TRACKING_SECRET
  delete process.env.CREDENTIALS_SECRET
}

describe('signing and encryption secrets', () => {
  it('refuses to run in production without a configured secret', () => {
    clearSecrets()
    process.env.NODE_ENV = 'production'
    expect(() => env.trackingSecret()).toThrow(/TRACKING_SECRET/)
    expect(() => env.credentialsSecret()).toThrow(/CREDENTIALS_SECRET or TRACKING_SECRET/)
  })

  it('uses the configured secret in production', () => {
    clearSecrets()
    process.env.NODE_ENV = 'production'
    process.env.TRACKING_SECRET = 'tracking-from-env'
    expect(env.trackingSecret()).toBe('tracking-from-env')
  })

  it('prefers CREDENTIALS_SECRET and falls back to TRACKING_SECRET', () => {
    clearSecrets()
    process.env.NODE_ENV = 'production'
    process.env.TRACKING_SECRET = 'tracking-from-env'
    expect(env.credentialsSecret()).toBe('tracking-from-env')
    process.env.CREDENTIALS_SECRET = 'credentials-from-env'
    expect(env.credentialsSecret()).toBe('credentials-from-env')
  })

  it('falls back to a clearly labelled dev-only secret outside production', () => {
    clearSecrets()
    process.env.NODE_ENV = 'development'
    expect(env.trackingSecret()).toMatch(/dev-only/)
    expect(env.credentialsSecret()).toMatch(/dev-only/)
    expect(env.usingDefaultCredentialsSecret()).toBe(true)
  })
})

describe('subscribeAllowedOrigins', () => {
  it('is empty when unset, so the signup endpoint is closed by default', () => {
    delete process.env.SUBSCRIBE_ALLOWED_ORIGINS
    expect(env.subscribeAllowedOrigins()).toEqual([])
  })

  it('splits, trims and drops empty entries', () => {
    process.env.SUBSCRIBE_ALLOWED_ORIGINS = ' https://a.test ,https://b.test,, '
    expect(env.subscribeAllowedOrigins()).toEqual(['https://a.test', 'https://b.test'])
  })
})

describe('vapid.subject', () => {
  it('prefers VAPID_SUBJECT, then the admin login, then a placeholder', () => {
    process.env.VAPID_SUBJECT = 'mailto:push@a.test'
    process.env.AUTH_EMAIL = 'admin@a.test'
    expect(env.vapid.subject()).toBe('mailto:push@a.test')

    delete process.env.VAPID_SUBJECT
    expect(env.vapid.subject()).toBe('mailto:admin@a.test')

    delete process.env.AUTH_EMAIL
    expect(env.vapid.subject()).toBe('mailto:admin@example.com')
  })
})
