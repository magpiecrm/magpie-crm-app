// Resolves which provider sends mail, and with what credentials.
//
// Precedence is applied at read time rather than migrated into the DB on boot,
// so it stays idempotent and survives a local_db.json copied between
// environments. Existing deployments that only set CLOUDFLARE_* or SMTP_* env
// vars keep working untouched until someone saves settings in the UI.

import crypto from 'crypto'
import { db } from './db'
import { env } from './env'
import { decryptToken, encryptToken } from './crypto'
import { PROVIDER_DESCRIPTORS, getDescriptor, isProviderId } from './providers/descriptors'
import type { ProviderCredentials, ProviderId } from './providers/types'

export interface ActiveProviderConfig {
  providerId: ProviderId
  creds: ProviderCredentials
  defaultSender?: string
  /** Required fields with no value — the caller falls back to mock logging. */
  missingFields: string[]
  /** Stored blob could not be decrypted, usually a rotated secret. */
  credsUnreadable: boolean
  /** Where the active provider id came from, for the UI hint. */
  source: 'db' | 'env'
}

/** Credentials implied by the legacy env vars, per provider. */
function envCredentials(providerId: ProviderId): ProviderCredentials {
  if (providerId === 'cloudflare') {
    return stripEmpty({
      apiToken: env.cloudflare.apiToken(),
      accountId: env.cloudflare.accountId(),
      zoneId: env.cloudflare.zoneId(),
    })
  }
  if (providerId === 'smtp') {
    const port = env.smtp.port()
    return stripEmpty({
      host: env.smtp.host(),
      port: port === undefined ? undefined : String(port),
      user: env.smtp.user(),
      pass: env.smtp.pass(),
    })
  }
  if (providerId === 'ses') {
    return stripEmpty({
      region: env.ses.region(),
      accessKeyId: env.ses.accessKeyId(),
      secretAccessKey: env.ses.secretAccessKey(),
      configurationSet: env.ses.configurationSet(),
      messageTags: env.ses.messageTags(),
    })
  }
  // The other providers are only configured in Settings → Sending.
  return {}
}

function stripEmpty(rec: Record<string, string | undefined>): ProviderCredentials {
  const out: ProviderCredentials = {}
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined && v !== '') out[k] = v
  }
  return out
}

/** Short fingerprint of the encryption secret, to detect rotation. */
function secretFingerprint(): string {
  return crypto.createHash('sha256').update(env.credentialsSecret()).digest('hex').slice(0, 8)
}

function decryptCreds(blob: string | undefined): ProviderCredentials | null {
  if (!blob) return null
  const decrypted = decryptToken(blob, env.credentialsSecret())
  return decrypted ? (decrypted as ProviderCredentials) : null
}

function encryptCreds(creds: ProviderCredentials): string {
  return encryptToken(creds, env.credentialsSecret())
}

/** The provider to use when none is saved: EMAIL_PROVIDER, else inferred from the env vars present. */
function inferProviderFromEnv(): ProviderId {
  const chosen = env.emailProvider()
  if (chosen && isProviderId(chosen)) return chosen
  if (env.ses.accessKeyId() && env.ses.secretAccessKey()) return 'ses'
  if (env.cloudflare.apiToken() && env.cloudflare.accountId()) return 'cloudflare'
  return 'smtp'
}

export function getActiveProviderConfig(): ActiveProviderConfig {
  const stored = db.getEmailSettings()

  // The host sends through its own Amazon SES account; nothing saved here applies.
  if (env.sendingManaged()) {
    const creds = envCredentials('ses')
    if (!creds.region) creds.region = 'us-east-1'
    const missingFields = (getDescriptor('ses')?.fields ?? []).filter((f) => f.required && !creds[f.key]).map((f) => f.label)
    const defaultSender = stored?.defaultSender || soleSenderRow()
    return { providerId: 'ses', creds, defaultSender, missingFields, credsUnreadable: false, source: 'env' }
  }

  const storedId = stored?.provider
  const providerId: ProviderId =
    storedId && isProviderId(storedId) ? storedId : inferProviderFromEnv()
  const source: 'db' | 'env' = storedId && isProviderId(storedId) ? 'db' : 'env'

  const blob = stored?.credentials?.[providerId]
  const decrypted = decryptCreds(blob)
  const credsUnreadable = Boolean(blob) && decrypted === null

  // DB values win per field; env fills anything the user has not set, which is
  // what keeps an untouched Cloudflare/SMTP deployment byte-identical.
  const creds: ProviderCredentials = {
    ...envCredentials(providerId),
    ...stripEmpty(decrypted ?? {}),
  }

  const descriptor = getDescriptor(providerId)
  for (const field of descriptor?.fields ?? []) {
    if (!creds[field.key] && field.defaultValue) creds[field.key] = field.defaultValue
  }

  const missingFields = (descriptor?.fields ?? [])
    .filter((f) => f.required && !creds[f.key])
    .map((f) => f.label)

  const defaultSender = stored?.defaultSender || env.smtp.sender() || soleSenderRow()

  return { providerId, creds, defaultSender, missingFields, credsUnreadable, source }
}

/**
 * When exactly one sender identity exists it is unambiguous enough to act as
 * the default, which keeps `sendIndividualEmailFn` (the one caller that passes
 * no `from`) working on deployments that never set SMTP_SENDER.
 */
function soleSenderRow(): string | undefined {
  const senders = db.data.senders
  if (senders.length !== 1) return undefined
  const { name, email } = senders[0]
  return name ? `"${name}" <${email}>` : email
}

export interface SaveProviderSettingsInput {
  provider: ProviderId
  defaultSender?: string
  /** Only the submitted provider's fields. Blank secrets mean "keep existing". */
  credentials: ProviderCredentials
  /** Secret fields to explicitly wipe, since blank means "keep". */
  clearFields?: string[]
}

export function saveProviderSettings(input: SaveProviderSettingsInput): void {
  if (env.sendingManaged()) throw new Error('Sending is run by your hosting provider, so it can\'t be changed here.')
  const stored = db.getEmailSettings()
  const descriptor = getDescriptor(input.provider)
  if (!descriptor) throw new Error(`Unknown provider: ${input.provider}`)

  const existing = decryptCreds(stored?.credentials?.[input.provider]) ?? {}
  const next: ProviderCredentials = { ...existing }

  for (const field of descriptor.fields) {
    const submitted = input.credentials[field.key]
    if (submitted === undefined) continue

    if (field.type === 'secret') {
      // A blank secret means the form was rendered with the value withheld, so
      // preserve what is stored. Clearing is an explicit, separate action.
      if (submitted !== '') next[field.key] = submitted
    } else {
      if (submitted === '') delete next[field.key]
      else next[field.key] = submitted
    }
  }

  for (const key of input.clearFields ?? []) delete next[key]

  db.saveEmailSettings({
    provider: input.provider,
    defaultSender: input.defaultSender ?? stored?.defaultSender,
    credentials: {
      ...(stored?.credentials ?? {}),
      [input.provider]: encryptCreds(next),
    },
    secret_fingerprint: secretFingerprint(),
    updated_at: new Date().toISOString(),
  })
}

/**
 * Everything the settings form needs, with secret values withheld. Secrets are
 * never echoed back — only whether they are set — so the UI cannot accidentally
 * save a mask string back as the real credential.
 */
export function getMaskedSettings() {
  const stored = db.getEmailSettings()
  const active = getActiveProviderConfig()

  // Every provider is returned, not just the active one, so switching the
  // dropdown shows that provider's saved fields without another round trip.
  const fields: Record<string, Record<string, { value: string; isSet: boolean }>> = {}

  for (const descriptor of PROVIDER_DESCRIPTORS) {
    const creds: ProviderCredentials = {
      ...envCredentials(descriptor.id),
      ...stripEmpty(decryptCreds(stored?.credentials?.[descriptor.id]) ?? {}),
    }

    fields[descriptor.id] = {}
    for (const field of descriptor.fields) {
      const value = creds[field.key] ?? field.defaultValue ?? ''
      fields[descriptor.id][field.key] = {
        // Secrets are never echoed back — only whether they are set — so the
        // form cannot save a mask string back as the real credential.
        value: field.type === 'secret' ? '' : value,
        isSet: (creds[field.key] ?? '') !== '',
      }
    }
  }

  return {
    provider: active.providerId,
    source: active.source,
    defaultSender: active.defaultSender ?? '',
    credsUnreadable: active.credsUnreadable,
    usingDefaultEncryptionSecret: env.usingDefaultCredentialsSecret(),
    missingFields: active.missingFields,
    fields,
  }
}
