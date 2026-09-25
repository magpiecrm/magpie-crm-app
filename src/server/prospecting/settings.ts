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
import { parseProxyConfig, type ProxyConfig } from './proxyRouter'

interface Secrets {
  socialfetchApiKey?: string
  reacherSecret?: string
  neverbounceApiKey?: string
  /** SOCKS5 proxies, stored in the encrypted blob because they hold passwords. */
  proxies?: ProxyConfig[]
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

/** Proxies saved in Settings, else REACHER_PROXIES. Empty means connect directly. */
export function getProxyConfigs(): { proxies: ProxyConfig[]; source: Source } {
  const stored = readSecrets().secrets.proxies
  if (stored?.length) return { proxies: stored, source: 'db' }
  const fromEnv = parseProxyConfig(env.reacher.proxies())
  return { proxies: fromEnv, source: fromEnv.length ? 'env' : null }
}

const proxyKey = (p: Pick<ProxyConfig, 'host' | 'port' | 'username'>) => `${p.host}:${p.port}:${p.username ?? ''}`

type VerificationProvider = 'reacher' | 'neverbounce' | 'none'

function neverbounceKey(): { value?: string; source: Source } {
  const stored = clean(readSecrets().secrets.neverbounceApiKey)
  if (stored) return { value: stored, source: 'db' }
  const fromEnv = clean(env.neverbounce.apiKey())
  return fromEnv ? { value: fromEnv, source: 'env' } : { source: null }
}

/** The NeverBounce key in use (saved, else env), whether or not NeverBounce is the active verifier. */
export function getNeverBounceKey(): string | null {
  return neverbounceKey().value ?? null
}

export type ActiveVerifier =
  | { provider: 'reacher'; reacher: ReacherConfig }
  /** `fallback`: Reacher, when the user asked for NeverBounce's unknowns to be retried there. */
  | { provider: 'neverbounce'; apiKey: string; fallback: ReacherConfig | null }
  | null

/**
 * The verifier emails are actually checked with. An explicit choice in
 * Settings wins; otherwise whichever is configured, Reacher first. A choice
 * whose settings are missing means no verification rather than silently
 * falling back to the other service.
 */
export function getActiveVerifier(): ActiveVerifier {
  const stored = db.getProspectingSettings()
  const chosen = stored?.verification_provider
  const reacher = getReacherConfig()
  const nbKey = neverbounceKey().value
  const fallback = stored?.reacher_fallback ? reacher : null
  if (chosen === 'none') return null
  if (chosen === 'reacher') return reacher ? { provider: 'reacher', reacher } : null
  if (chosen === 'neverbounce') return nbKey ? { provider: 'neverbounce', apiKey: nbKey, fallback } : null
  if (reacher) return { provider: 'reacher', reacher }
  if (nbKey) return { provider: 'neverbounce', apiKey: nbKey, fallback }
  return null
}

/**
 * Only verified emails are shown or saved unless the user explicitly turned
 * this off; catch-all, risky and unconfirmed guesses are withheld.
 */
export function isVerifiedOnly(): boolean {
  return db.getProspectingSettings()?.verified_only !== false
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
  /**
   * Full proxy list to save (replaces the saved one). A blank password keeps
   * the saved password for the same host, port and username.
   */
  proxies?: ProxyConfig[]
  verificationProvider?: VerificationProvider
  neverbounceApiKey?: string
  reacherFallback?: boolean
  verifiedOnly?: boolean
  /** Secret fields to remove. Blank secret inputs otherwise mean "keep". */
  clear?: Array<'socialfetchApiKey' | 'reacherSecret' | 'neverbounceApiKey'>
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

  if (input.proxies) {
    const previous = new Map((next.proxies ?? []).map((p) => [proxyKey(p), p]))
    const cleaned: ProxyConfig[] = []
    for (const [i, p] of input.proxies.entries()) {
      const host = clean(p.host)
      const port = Number(p.port)
      if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error(`Proxy ${i + 1}: enter a hostname or IP address.`)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Proxy ${i + 1}: port must be 1-65535.`)
      const username = clean(p.username)
      const password = clean(p.password) ?? previous.get(proxyKey({ host, port, username }))?.password
      cleaned.push({ host, port, username, password, label: clean(p.label) ?? `proxy-${i + 1}` })
    }
    next.proxies = cleaned
  }

  const newNbKey = clean(input.neverbounceApiKey)
  if (newNbKey && (/\s/.test(newNbKey) || newNbKey.length < 16)) {
    throw new Error('That doesn’t look like a NeverBounce API key.')
  }

  for (const field of input.clear ?? []) delete next[field]
  if (newKey) next.socialfetchApiKey = newKey
  if (newNbKey) next.neverbounceApiKey = newNbKey
  if (clean(input.reacherSecret)) next.reacherSecret = clean(input.reacherSecret)

  const reacherUrl = clean(input.reacherUrl)
  if (reacherUrl && !/^https?:\/\//i.test(reacherUrl)) {
    throw new Error('Reacher URL must start with http:// or https://')
  }

  db.saveProspectingSettings({
    secrets: Object.keys(next).length ? encryptToken(next, env.credentialsSecret()) : undefined,
    verification_provider: input.verificationProvider ?? current?.verification_provider,
    reacher_fallback: input.reacherFallback ?? current?.reacher_fallback,
    verified_only: input.verifiedOnly ?? current?.verified_only,
    reacher_url: input.reacherUrl === undefined ? current?.reacher_url : reacherUrl,
    reacher_from_email: input.reacherFromEmail === undefined ? current?.reacher_from_email : fromEmail,
    reacher_hello_name: input.reacherHelloName === undefined ? current?.reacher_hello_name : helloName,
    updated_at: new Date().toISOString(),
  })
}

/** What the settings form shows. Secrets are never sent back, only a hint. */
export function getMaskedProspectingSettings() {
  const key = socialfetchKey()
  const nb = neverbounceKey()
  const active = getActiveVerifier()
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
    proxies: (() => {
      const { proxies, source } = getProxyConfigs()
      return {
        source,
        // Passwords are never sent back, only whether one is set.
        list: proxies.map((p) => ({ label: p.label ?? '', host: p.host, port: p.port, username: p.username ?? '', passwordSet: Boolean(p.password) })),
      }
    })(),
    neverbounce: {
      isSet: Boolean(nb.value),
      hint: nb.value ? `…${nb.value.slice(-4)}` : null,
      source: nb.source,
    },
    verification: {
      /** What the user picked; null means automatic. */
      chosen: (db.getProspectingSettings()?.verification_provider ?? null) as VerificationProvider | null,
      active: active?.provider ?? null,
      reacherFallback: Boolean(db.getProspectingSettings()?.reacher_fallback),
      verifiedOnly: isVerifiedOnly(),
    },
    credsUnreadable: readSecrets().unreadable,
    usingDefaultEncryptionSecret: env.usingDefaultCredentialsSecret(),
  }
}
