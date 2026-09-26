// Copilot credentials: bring your own Anthropic or OpenAI API key.
//
// Claude runs through the Claude Code CLI, and Anthropic's terms require
// products to authenticate it with an API key rather than a Claude.ai
// (Free/Pro/Max) login, which is for one person's own use and can't be shared
// between an app's users (code.claude.com/docs/en/legal-and-compliance).
// OpenAI models are called on the API directly (copilot/openai.ts), again
// only with an API key, never a ChatGPT login. So a key is the only way in:
// saved here (encrypted, like the prospecting keys) or set as
// ANTHROPIC_API_KEY / OPENAI_API_KEY. Usage is billed to whoever owns the key.
//
// The Claude CLI also gets its own config directory, so it never picks up a
// Claude.ai login (or MCP servers, settings) belonging to the account the app
// runs as.

import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { db } from '../db'
import { env } from '../env'
import { decryptToken, encryptToken } from '../crypto'

interface Secrets {
  anthropicApiKey?: string
  openaiApiKey?: string
}

export type KeyField = keyof Secrets
type Source = 'db' | 'env' | null

const clean = (v: string | undefined | null) => (v && v.trim() ? v.trim() : undefined)

function readSecrets(): { secrets: Secrets; unreadable: boolean } {
  const blob = db.getCopilotSettings()?.secrets
  if (!blob) return { secrets: {}, unreadable: false }
  const decrypted = decryptToken(blob, env.credentialsSecret())
  return decrypted ? { secrets: decrypted as Secrets, unreadable: false } : { secrets: {}, unreadable: true }
}

const ENV_FALLBACK: Record<KeyField, () => string | undefined> = {
  anthropicApiKey: () => env.anthropic.apiKey(),
  openaiApiKey: () => env.openai.apiKey(),
}

function readKey(field: KeyField): { value?: string; source: Source } {
  const stored = clean(readSecrets().secrets[field])
  if (stored) return { value: stored, source: 'db' }
  const fromEnv = clean(ENV_FALLBACK[field]())
  return fromEnv ? { value: fromEnv, source: 'env' } : { source: null }
}

/** The key Claude runs with. Throws a message that points at Settings. */
export function requireAnthropicKey(): string {
  const { value } = readKey('anthropicApiKey')
  if (!value) throw new Error('The copilot needs an Anthropic API key for Claude models. Add one in Settings → Copilot.')
  return value
}

/** The key OpenAI models run with. Throws a message that points at Settings. */
export function requireOpenAIKey(): string {
  const { value } = readKey('openaiApiKey')
  if (!value) throw new Error('The copilot needs an OpenAI API key for OpenAI models. Add one in Settings → Copilot.')
  return value
}

export function hasKey(field: KeyField): boolean {
  return Boolean(readKey(field).value)
}

/**
 * Anthropic keys look like `sk-ant-…`, OpenAI keys like `sk-…` (`sk-proj-…`,
 * `sk-svcacct-…`). Catches a pasted password or URL, or a key in the wrong box.
 */
const KEY_FORMAT: Record<KeyField, { test: (key: string) => boolean; error: string }> = {
  anthropicApiKey: {
    test: (key) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key),
    error: 'That doesn’t look like an Anthropic API key. Keys start with "sk-ant-".',
  },
  openaiApiKey: {
    test: (key) => /^sk-[A-Za-z0-9_-]{20,}$/.test(key) && !key.startsWith('sk-ant-'),
    error: 'That doesn’t look like an OpenAI API key. Keys start with "sk-" (e.g. "sk-proj-").',
  },
}

export function saveCopilotSettings(input: { anthropicApiKey?: string; openaiApiKey?: string; clear?: KeyField[] }) {
  const { secrets, unreadable } = readSecrets()
  const next: Secrets = unreadable ? {} : { ...secrets }
  const typed: Array<[KeyField, string]> = []
  for (const field of ['anthropicApiKey', 'openaiApiKey'] as const) {
    const key = clean(input[field])
    if (!key) continue
    if (!KEY_FORMAT[field].test(key)) throw new Error(KEY_FORMAT[field].error)
    typed.push([field, key])
  }
  for (const field of input.clear ?? []) delete next[field]
  for (const [field, key] of typed) next[field] = key
  db.saveCopilotSettings({
    secrets: Object.keys(next).length ? encryptToken(next, env.credentialsSecret()) : undefined,
    updated_at: new Date().toISOString(),
  })
}

function masked(field: KeyField) {
  const key = readKey(field)
  return {
    isSet: Boolean(key.value),
    hint: key.value ? `…${key.value.slice(-4)}` : null,
    source: key.source,
  }
}

/** What the settings form shows. The keys themselves are never sent back. */
export function getMaskedCopilotSettings() {
  return {
    anthropic: masked('anthropicApiKey'),
    openai: masked('openaiApiKey'),
    credsUnreadable: readSecrets().unreadable,
  }
}

/**
 * Checks a key against the provider's model list (a free call). Tests the key
 * typed into the form when given, otherwise the saved one.
 */
export async function testAnthropicKey(typed?: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = clean(typed) ?? readKey('anthropicApiKey').value
  if (!key) return { ok: false, error: 'No Anthropic API key yet.' }
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'Anthropic rejected this key. Check it in the Claude Console.' }
    if (res.status === 403) return { ok: false, error: 'This key isn’t allowed to use the API (check its workspace and permissions).' }
    return { ok: false, error: `Anthropic returned HTTP ${res.status}.` }
  } catch {
    return { ok: false, error: 'Couldn’t reach Anthropic.' }
  }
}

export async function testOpenAIKey(typed?: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = clean(typed) ?? readKey('openaiApiKey').value
  if (!key) return { ok: false, error: 'No OpenAI API key yet.' }
  try {
    const res = await fetchImpl('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'OpenAI rejected this key. Check it on the OpenAI platform.' }
    if (res.status === 403) return { ok: false, error: 'This key isn’t allowed to use the API (check its project and permissions).' }
    return { ok: false, error: `OpenAI returned HTTP ${res.status}.` }
  } catch {
    return { ok: false, error: 'Couldn’t reach OpenAI.' }
  }
}

/**
 * A config directory owned by the app, next to its database, so the CLI never
 * sees the host account's own Claude login, settings or MCP servers.
 */
export function copilotConfigDir(): string {
  const dbPath = env.databasePath()
  const base = dbPath ? dirname(dbPath) : process.cwd()
  const dir = join(base, '.copilot-claude')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
