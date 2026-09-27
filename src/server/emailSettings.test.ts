import { beforeEach, describe, expect, it, vi } from 'vitest'

// The precedence rule (DB -> env -> mock) is what keeps existing deployments
// sending after this change, so it is worth pinning down explicitly.

const dbState: {
  settings: any
  senders: Array<{ id: number; name: string; email: string }>
} = { settings: null, senders: [] }

const envState: Record<string, string | undefined> = {}

vi.mock('./db', () => ({
  db: {
    getEmailSettings: () => dbState.settings,
    saveEmailSettings: (next: any) => {
      dbState.settings = next
      return next
    },
    get data() {
      return { senders: dbState.senders }
    },
  },
}))

vi.mock('./env', () => ({
  env: {
    cloudflare: {
      apiToken: () => envState.CLOUDFLARE_API_TOKEN,
      accountId: () => envState.CLOUDFLARE_ACCOUNT_ID,
      zoneId: () => envState.CLOUDFLARE_ZONE_ID,
    },
    smtp: {
      host: () => envState.SMTP_HOST,
      port: () => (envState.SMTP_PORT ? parseInt(envState.SMTP_PORT, 10) : undefined),
      user: () => envState.SMTP_USER,
      pass: () => envState.SMTP_PASS || '',
      sender: () => envState.SMTP_SENDER,
    },
    ses: {
      region: () => envState.SES_REGION,
      accessKeyId: () => envState.SES_ACCESS_KEY_ID,
      secretAccessKey: () => envState.SES_SECRET_ACCESS_KEY,
      configurationSet: () => envState.SES_CONFIGURATION_SET,
      messageTags: () => envState.SES_MESSAGE_TAGS,
    },
    emailProvider: () => envState.EMAIL_PROVIDER,
    sendingManaged: () => envState.SENDING_MANAGED === 'on',
    credentialsSecret: () => 'test-secret',
    usingDefaultCredentialsSecret: () => false,
    trackingSecret: () => 'test-secret',
  },
}))

const { getActiveProviderConfig, getMaskedSettings, saveProviderSettings } = await import(
  './emailSettings'
)

beforeEach(() => {
  dbState.settings = null
  dbState.senders = []
  for (const key of Object.keys(envState)) delete envState[key]
})

describe('SES from the environment', () => {
  it('is used when its keys are set, with the region defaulting', () => {
    envState.SES_ACCESS_KEY_ID = 'AKIATEST'
    envState.SES_SECRET_ACCESS_KEY = 'secret'
    const config = getActiveProviderConfig()
    expect(config.providerId).toBe('ses')
    expect(config.creds).toMatchObject({ accessKeyId: 'AKIATEST', secretAccessKey: 'secret', region: 'us-east-1' })
    expect(config.missingFields).toEqual([])
    // The secret is never sent back to the settings form.
    expect(JSON.stringify(getMaskedSettings())).not.toContain('"secret"')
  })

  it('EMAIL_PROVIDER picks the provider explicitly', () => {
    envState.EMAIL_PROVIDER = 'ses'
    envState.SES_REGION = 'eu-west-2'
    const config = getActiveProviderConfig()
    expect(config.providerId).toBe('ses')
    expect(config.creds.region).toBe('eu-west-2')
    expect(config.missingFields.length).toBeGreaterThan(0)
  })

  it('ignores an unknown EMAIL_PROVIDER', () => {
    envState.EMAIL_PROVIDER = 'carrier-pigeon'
    expect(getActiveProviderConfig().providerId).toBe('smtp')
  })
})

describe('SENDING_MANAGED', () => {
  it("sends through the host's mail server with this copy's login, whatever was saved, and refuses changes", () => {
    saveProviderSettings({ provider: 'resend', credentials: { apiKey: 're_mine' } })
    envState.SENDING_MANAGED = 'on'
    envState.EMAIL_PROVIDER = 'smtp'
    envState.SMTP_HOST = 'mta.host.test'
    envState.SMTP_PORT = '587'
    envState.SMTP_USER = 'acme'
    envState.SMTP_PASS = 'host-made-password'
    const config = getActiveProviderConfig()
    expect(config.providerId).toBe('smtp')
    expect(config.creds).toEqual({ host: 'mta.host.test', port: '587', user: 'acme', pass: 'host-made-password' })
    expect(config.missingFields).toEqual([])
    expect(() => saveProviderSettings({ provider: 'smtp', credentials: { host: 'x' } })).toThrow(/hosting provider/)
  })

  it("still sends through the host's SES until the host moves the copy over", () => {
    saveProviderSettings({ provider: 'smtp', credentials: { host: 'mine.example.test', port: '587' } })
    envState.SENDING_MANAGED = 'on'
    envState.SES_ACCESS_KEY_ID = 'AKIAHOST'
    envState.SES_SECRET_ACCESS_KEY = 'host-secret'
    envState.SES_REGION = 'eu-west-2'
    const config = getActiveProviderConfig()
    expect(config.providerId).toBe('ses')
    expect(config.creds).toMatchObject({ accessKeyId: 'AKIAHOST', region: 'eu-west-2' })
    expect(config.creds.host).toBeUndefined()
  })
})

describe('back-compat with no saved settings', () => {
  it('infers cloudflare when both cloudflare env vars are set', () => {
    envState.CLOUDFLARE_API_TOKEN = 'tok'
    envState.CLOUDFLARE_ACCOUNT_ID = 'acct'
    envState.SMTP_SENDER = '"Acme" <hi@acme.com>'

    const config = getActiveProviderConfig()

    expect(config.providerId).toBe('cloudflare')
    expect(config.source).toBe('env')
    expect(config.creds).toMatchObject({ apiToken: 'tok', accountId: 'acct' })
    expect(config.defaultSender).toBe('"Acme" <hi@acme.com>')
    expect(config.missingFields).toEqual([])
  })

  it('falls back to smtp when only SMTP vars are set', () => {
    envState.SMTP_HOST = 'smtp.zoho.eu'
    envState.SMTP_PORT = '465'
    envState.SMTP_USER = 'hi@acme.com'
    envState.SMTP_PASS = 'pw'

    const config = getActiveProviderConfig()

    expect(config.providerId).toBe('smtp')
    expect(config.creds).toMatchObject({ host: 'smtp.zoho.eu', port: '465', user: 'hi@acme.com' })
    expect(config.missingFields).toEqual([])
  })

  it('reports missing fields when nothing is configured, so sending mocks', () => {
    const config = getActiveProviderConfig()
    expect(config.providerId).toBe('smtp')
    expect(config.missingFields.length).toBeGreaterThan(0)
  })

  it('uses the sole sender row when SMTP_SENDER is absent', () => {
    dbState.senders = [{ id: 1, name: 'Acme', email: 'hi@acme.com' }]
    expect(getActiveProviderConfig().defaultSender).toBe('"Acme" <hi@acme.com>')
  })

  it('does not guess a default sender when several exist', () => {
    dbState.senders = [
      { id: 1, name: 'A', email: 'a@acme.com' },
      { id: 2, name: 'B', email: 'b@acme.com' },
    ]
    expect(getActiveProviderConfig().defaultSender).toBeUndefined()
  })
})

describe('saved settings', () => {
  it('overrides the env-inferred provider', () => {
    envState.CLOUDFLARE_API_TOKEN = 'tok'
    envState.CLOUDFLARE_ACCOUNT_ID = 'acct'

    saveProviderSettings({
      provider: 'resend',
      defaultSender: '"Acme" <hi@acme.com>',
      credentials: { apiKey: 're_live_123' },
    })

    const config = getActiveProviderConfig()
    expect(config.providerId).toBe('resend')
    expect(config.source).toBe('db')
    expect(config.creds.apiKey).toBe('re_live_123')
  })

  it('keeps a stored secret when the field is submitted blank', () => {
    saveProviderSettings({ provider: 'resend', credentials: { apiKey: 're_live_123' } })
    // The form renders secrets empty, so a save without retyping must not wipe.
    saveProviderSettings({ provider: 'resend', credentials: { apiKey: '' } })

    expect(getActiveProviderConfig().creds.apiKey).toBe('re_live_123')
  })

  it('clears a secret only when explicitly asked', () => {
    saveProviderSettings({ provider: 'resend', credentials: { apiKey: 're_live_123' } })
    saveProviderSettings({ provider: 'resend', credentials: {}, clearFields: ['apiKey'] })

    expect(getActiveProviderConfig().creds.apiKey).toBeUndefined()
  })

  it('retains other providers credentials when switching away and back', () => {
    saveProviderSettings({ provider: 'resend', credentials: { apiKey: 're_live_123' } })
    saveProviderSettings({ provider: 'postmark', credentials: { serverToken: 'pm_tok' } })
    saveProviderSettings({ provider: 'resend', credentials: {} })

    expect(getActiveProviderConfig().creds.apiKey).toBe('re_live_123')
  })

  it('stores secrets encrypted rather than in plaintext', () => {
    saveProviderSettings({ provider: 'resend', credentials: { apiKey: 're_live_123' } })
    expect(JSON.stringify(dbState.settings)).not.toContain('re_live_123')
  })

  it('applies descriptor defaults for fields the user left alone', () => {
    saveProviderSettings({ provider: 'postmark', credentials: { serverToken: 'tok' } })
    expect(getActiveProviderConfig().creds.messageStream).toBe('broadcast')
  })
})

describe('masking', () => {
  it('never returns a secret value, only whether it is set', () => {
    saveProviderSettings({ provider: 'resend', credentials: { apiKey: 're_live_123' } })

    const masked = getMaskedSettings()
    expect(JSON.stringify(masked)).not.toContain('re_live_123')
    expect(masked.fields.resend.apiKey).toEqual({ value: '', isSet: true })
  })

  it('returns non-secret values so the form round-trips', () => {
    saveProviderSettings({
      provider: 'mailgun',
      credentials: { apiKey: 'k', domain: 'mg.acme.com', region: 'eu' },
    })

    const masked = getMaskedSettings()
    expect(masked.fields.mailgun.domain.value).toBe('mg.acme.com')
    expect(masked.fields.mailgun.region.value).toBe('eu')
    expect(masked.fields.mailgun.apiKey.value).toBe('')
  })

  it('flags credentials it cannot decrypt instead of failing silently', () => {
    dbState.settings = {
      provider: 'resend',
      credentials: { resend: 'not-a-valid-blob' },
      updated_at: new Date().toISOString(),
    }

    const config = getActiveProviderConfig()
    expect(config.credsUnreadable).toBe(true)
    expect(config.creds.apiKey).toBeUndefined()
  })
})
