import { afterAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'api-key-scopes-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { db } = await import('./db')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const hash = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')

describe('API key scopes', () => {
  // A signup-form key may sit in a website's code; an MCP key gives an AI app
  // full access. Neither may work as the other.
  it('keeps public-API keys and MCP keys apart', () => {
    db.addApiKey('Website form', hash('vtl_form'), 'vtl_f…', 'api')
    db.addApiKey('Claude Desktop', hash('vtl_mcp_desk'), 'vtl_mcp_d…', 'mcp')

    expect(db.verifyApiKey('vtl_form')).toBe(true)
    expect(db.verifyApiKey('vtl_form', 'mcp')).toBe(false)
    expect(db.verifyApiKey('vtl_mcp_desk', 'mcp')).toBe(true)
    expect(db.verifyApiKey('vtl_mcp_desk')).toBe(false)

    expect(db.getApiKeys().map((k) => k.name)).toEqual(['Website form'])
    expect(db.getApiKeys('mcp').map((k) => k.name)).toEqual(['Claude Desktop'])
  })

  it('treats keys made before scopes existed as public-API keys', () => {
    db.data.api_keys!.push({ id: 'old', name: 'Old key', key_hash: hash('vtl_old'), masked_key: 'vtl_o…', created_at: '2025-01-01T00:00:00Z' })
    expect(db.verifyApiKey('vtl_old')).toBe(true)
    expect(db.verifyApiKey('vtl_old', 'mcp')).toBe(false)
  })

  it('records when an MCP key was last used, and stops working once revoked', () => {
    const [key] = db.getApiKeys('mcp')
    expect(key.last_used_at).not.toBeNull()
    db.deleteApiKey(key.id)
    expect(db.verifyApiKey('vtl_mcp_desk', 'mcp')).toBe(false)
  })
})
