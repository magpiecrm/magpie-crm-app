// Copilot credentials: bring your own Anthropic API key.
//
// The copilot runs the Claude Code CLI, and Anthropic's terms require products
// to authenticate it with an API key rather than a Claude.ai (Free/Pro/Max)
// login, which is for one person's own use and can't be shared between an
// app's users (code.claude.com/docs/en/legal-and-compliance). So the key is
// the only way in: saved here (encrypted, like the prospecting keys) or set as
// ANTHROPIC_API_KEY. Usage is billed to whoever owns the key.
//
// The CLI also gets its own config directory, so it never picks up a Claude.ai
// login (or MCP servers, settings) belonging to the account the app runs as.

import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { db } from '../db'
import { env } from '../env'
import { decryptToken, encryptToken } from '../crypto'

interface Secrets {
  anthropicApiKey?: string
}

type Source = 'db' | 'env' | null

const clean = (v: string | undefined | null) => (v && v.trim() ? v.trim() : undefined)

function readSecrets(): { secrets: Secrets; unreadable: boolean } {
  const blob = db.getCopilotSettings()?.secrets
  if (!blob) return { secrets: {}, unreadable: false }
  const decrypted = decryptToken(blob, env.credentialsSecret())
  return decrypted ? { secrets: decrypted as Secrets, unreadable: false } : { secrets: {}, unreadable: true }
}

function anthropicKey(): { value?: string; source: Source } {
  const stored = clean(readSecrets().secrets.anthropicApiKey)
  if (stored) return { value: stored, source: 'db' }
  const fromEnv = clean(env.anthropic.apiKey())
  return fromEnv ? { value: fromEnv, source: 'env' } : { source: null }
}

/** The key the copilot runs with. Throws a message that points at Settings. */
export function requireAnthropicKey(): string {
  const { value } = anthropicKey()
  if (!value) throw new Error('The copilot needs an Anthropic API key. Add one in Settings → Copilot.')
  return value
}

/** Anthropic keys look like `sk-ant-…`; this catches a pasted password or URL. */
function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)
}

export function saveCopilotSettings(input: { anthropicApiKey?: string; clear?: Array<'anthropicApiKey'> }) {
  const { secrets, unreadable } = readSecrets()
  const next: Secrets = unreadable ? {} : { ...secrets }
  const key = clean(input.anthropicApiKey)
  if (key && !looksLikeAnthropicKey(key)) {
    throw new Error('That doesn’t look like an Anthropic API key. Keys start with "sk-ant-".')
  }
  for (const field of input.clear ?? []) delete next[field]
  if (key) next.anthropicApiKey = key
  db.saveCopilotSettings({
    secrets: Object.keys(next).length ? encryptToken(next, env.credentialsSecret()) : undefined,
    updated_at: new Date().toISOString(),
  })
}

/** What the settings form shows. The key itself is never sent back. */
export function getMaskedCopilotSettings() {
  const key = anthropicKey()
  return {
    anthropic: {
      isSet: Boolean(key.value),
      hint: key.value ? `…${key.value.slice(-4)}` : null,
      source: key.source,
    },
    credsUnreadable: readSecrets().unreadable,
  }
}

/**
 * Checks a key against Anthropic's model list (a free call). Tests the key
 * typed into the form when given, otherwise the saved one.
 */
export async function testAnthropicKey(typed?: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = clean(typed) ?? anthropicKey().value
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
