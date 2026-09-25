// Prospecting integrations: the SocialFetch API key and the optional Reacher
// verification service.
//
// Values saved in Settings → Prospecting live in the DB (secrets encrypted with
// the credentials secret, like the email provider settings) so they survive
// redeploys; the SOCIALFETCH_* / REACHER_* env vars still work as a fallback.
// A saved value always wins over the env var.

import { db } from '../db'
import { env } from '../env'
import { decryptToken, encryptToken } from '../crypto'

interface Secrets {
  socialfetchApiKey?: string
  reacherSecret?: string
}

export interface ReacherConfig {
  url: string
  secret?: string
  fromEmail?: string
  helloName?: string
}

type Source = 'db' | 'env' | null

function readSecrets(): { secrets: Secrets; unreadable: boolean } {
  const blob = db.getProspectingSettings()?.secrets
  if (!blob) return { secrets: {}, unreadable: false }
  const decrypted = decryptToken(blob, env.credentialsSecret())
  return decrypted ? { secrets: decrypted as Secrets, unreadable: false } : { secrets: {}, unreadable: true }
}

const clean = (v: string | undefined | null) => (v && v.trim() ? v.trim() : undefined)

function socialfetchKey(): { value?: string; source: Source } {
  const stored = clean(readSecrets().secrets.socialfetchApiKey)
  if (stored) return { value: stored, source: 'db' }
  const fromEnv = clean(env.socialfetch.apiKey())
  return fromEnv ? { value: fromEnv, source: 'env' } : { source: null }
}

/** The key to call SocialFetch with. Throws a message that points at Settings. */
export function requireSocialFetchKey(): string {
  const { value } = socialfetchKey()
  if (!value) throw new Error('No SocialFetch API key yet. Add one in Settings → Prospecting.')
  return value
}

export function isSocialFetchConfigured(): boolean {
  return Boolean(socialfetchKey().value)
}

/** Null when no Reacher URL is set, i.e. verification is off. */
export function getReacherConfig(): ReacherConfig | null {
  const stored = db.getProspectingSettings()
  const url = clean(stored?.reacher_url) ?? clean(env.reacher.url())
  if (!url) return null
  return {
    url: url.replace(/\/+$/, ''),
    secret: clean(readSecrets().secrets.reacherSecret) ?? clean(env.reacher.secret()),
    fromEmail: clean(stored?.reacher_from_email) ?? clean(env.reacher.fromEmail()),
    helloName: clean(stored?.reacher_hello_name) ?? clean(env.reacher.helloName()),
  }
}

export interface SaveProspectingInput {
  socialfetchApiKey?: string
  reacherUrl?: string
  reacherSecret?: string
  reacherFromEmail?: string
  reacherHelloName?: string
  /** Secret fields to remove. Blank secret inputs otherwise mean "keep". */
  clear?: Array<'socialfetchApiKey' | 'reacherSecret'>
}

export function saveProspectingSettings(input: SaveProspectingInput) {
  const current = db.getProspectingSettings()
  const { secrets, unreadable } = readSecrets()
  // An unreadable blob (rotated secret) can't be merged, so start clean.
  const next: Secrets = unreadable ? {} : { ...secrets }

  const newKey = clean(input.socialfetchApiKey)
  // SocialFetch keys are documented as `sfk_…`; catching anything else here
  // stops an autofilled password or pasted URL being saved as the key.
  if (newKey && !/^sfk_\S+$/.test(newKey)) {
    throw new Error('That doesn’t look like a SocialFetch API key. Keys start with "sfk_".')
  }
  const fromEmail = clean(input.reacherFromEmail)
  if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    throw new Error('FROM address must be an email address.')
  }
  const helloName = clean(input.reacherHelloName)
  if (helloName && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(helloName)) {
    throw new Error('HELO name must be a hostname like mail.yourdomain.com.')
  }

  for (const field of input.clear ?? []) delete next[field]
  if (newKey) next.socialfetchApiKey = newKey
  if (clean(input.reacherSecret)) next.reacherSecret = clean(input.reacherSecret)

  const reacherUrl = clean(input.reacherUrl)
  if (reacherUrl && !/^https?:\/\//i.test(reacherUrl)) {
    throw new Error('Reacher URL must start with http:// or https://')
  }

  db.saveProspectingSettings({
    secrets: Object.keys(next).length ? encryptToken(next, env.credentialsSecret()) : undefined,
    reacher_url: input.reacherUrl === undefined ? current?.reacher_url : reacherUrl,
    reacher_from_email: input.reacherFromEmail === undefined ? current?.reacher_from_email : fromEmail,
    reacher_hello_name: input.reacherHelloName === undefined ? current?.reacher_hello_name : helloName,
    updated_at: new Date().toISOString(),
  })
}

/** What the settings form shows. Secrets are never sent back, only a hint. */
export function getMaskedProspectingSettings() {
  const key = socialfetchKey()
  const reacher = getReacherConfig()
  const stored = db.getProspectingSettings()
  return {
    socialfetch: {
      isSet: Boolean(key.value),
      // Last four characters only, so the user can tell which key is in use.
      hint: key.value ? `…${key.value.slice(-4)}` : null,
      source: key.source,
    },
    reacher: {
      url: reacher?.url ?? '',
      urlSource: (clean(stored?.reacher_url) ? 'db' : reacher ? 'env' : null) as Source,
      secretIsSet: Boolean(reacher?.secret),
      fromEmail: reacher?.fromEmail ?? '',
      helloName: reacher?.helloName ?? '',
    },
    proxiesConfigured: Boolean(clean(env.reacher.proxies())),
    credsUnreadable: readSecrets().unreadable,
    usingDefaultEncryptionSecret: env.usingDefaultCredentialsSecret(),
  }
}
