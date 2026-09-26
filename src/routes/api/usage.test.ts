import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'usage-test-'))
const dbFile = join(scratchDir, 'local_db.json')
process.env.DATABASE_PATH = dbFile

const { Route } = await import('./usage')
const { recordUsage, getUsage, usageForMonth } = await import('../../server/usage')
const handlers = (Route as any).options.server.handlers

const originalToken = process.env.USAGE_API_TOKEN
afterEach(() => {
  if (originalToken === undefined) delete process.env.USAGE_API_TOKEN
  else process.env.USAGE_API_TOKEN = originalToken
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const get = (path: string, token?: string) =>
  handlers.GET({ request: new Request(`http://app.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }) })

describe('usage counts', () => {
  it('adds up by month and fills in every counter', () => {
    recordUsage({ searches: 2, prospects: 9 }, new Date('2026-08-31T23:00:00Z'))
    recordUsage({ prospects: 1, emailLookups: 3, emailsFound: 1 }, new Date('2026-09-01T09:00:00Z'))
    recordUsage({ emailsSent: 250 }, new Date('2026-09-15T09:00:00Z'))
    expect(getUsage()).toEqual([
      { month: '2026-08', searches: 2, prospects: 9, emailLookups: 0, emailsFound: 0, contactsSaved: 0, emailsSent: 0 },
      { month: '2026-09', searches: 0, prospects: 1, emailLookups: 3, emailsFound: 1, contactsSaved: 0, emailsSent: 250 },
    ])
    expect(usageForMonth('2025-01')).toMatchObject({ prospects: 0, emailsSent: 0 })
  })

  it('stores counts only', () => {
    const stored = JSON.parse(readFileSync(dbFile, 'utf8')).usage
    expect(stored['2026-09']).toEqual({ prospects: 1, emailLookups: 3, emailsFound: 1, emailsSent: 250 })
  })
})

describe('GET /api/usage', () => {
  it('is off unless USAGE_API_TOKEN is set', async () => {
    delete process.env.USAGE_API_TOKEN
    expect((await get('/api/usage', 'anything')).status).toBe(404)
  })

  it('needs the token', async () => {
    process.env.USAGE_API_TOKEN = 'tok_123'
    expect((await get('/api/usage')).status).toBe(401)
    expect((await get('/api/usage', 'tok_12')).status).toBe(401)
    const res = await get('/api/usage', 'tok_123')
    expect(res.status).toBe(200)
    expect((await res.json()).months.map((m: any) => m.month)).toEqual(['2026-08', '2026-09'])
  })

  it('returns one month, and rejects a malformed one', async () => {
    process.env.USAGE_API_TOKEN = 'tok_123'
    expect(await (await get('/api/usage?month=2026-09', 'tok_123')).json()).toMatchObject({ month: '2026-09', emailsSent: 250 })
    expect((await get('/api/usage?month=2026-9', 'tok_123')).status).toBe(400)
  })
})
