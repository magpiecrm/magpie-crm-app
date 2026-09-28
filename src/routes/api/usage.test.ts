import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'usage-test-'))
const dbFile = join(scratchDir, 'local_db.json')
process.env.DATABASE_PATH = dbFile

const { Route } = await import('./usage')
const { recordLookup, recordUsage, getUsage, usageForMonth } = await import('../../server/usage')
const { LOOKUP_OUTCOMES } = await import('../../server/prospecting/types')
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
    recordLookup('verified', new Date('2026-09-15T09:00:00Z'))
    recordLookup('catchAll', new Date('2026-09-15T09:00:00Z'))
    recordLookup('catchAll', new Date('2026-09-15T09:00:00Z'))
    const [aug, sep] = getUsage()
    expect(aug).toMatchObject({ month: '2026-08', searches: 2, prospects: 9, emailLookups: 0, emailsFound: 0, contactsSaved: 0, emailsSent: 0, lookupVerified: 0 })
    expect(sep).toMatchObject({ month: '2026-09', searches: 0, prospects: 1, emailLookups: 3, emailsFound: 1, contactsSaved: 0, emailsSent: 250 })
    // One counter per lookup outcome, every one filled in.
    expect(sep).toMatchObject({ lookupVerified: 1, lookupCatchAll: 2, lookupRejected: 0, lookupNoDomain: 0, lookupLimit: 0 })
    expect(Object.keys(sep)).toHaveLength(1 + 7 + LOOKUP_OUTCOMES.length)
    expect(usageForMonth('2025-01')).toMatchObject({ prospects: 0, emailsSent: 0 })
  })

  it('stores counts only', () => {
    const stored = JSON.parse(readFileSync(dbFile, 'utf8')).usage
    expect(stored['2026-09']).toEqual({ prospects: 1, emailLookups: 3, emailsFound: 1, emailsSent: 250, lookupVerified: 1, lookupCatchAll: 2 })
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
    const body = await (await get('/api/usage?month=2026-09', 'tok_123')).json()
    expect(body).toMatchObject({ month: '2026-09', emailsSent: 250 })
    // How big the copy's data is, for the host: a size and row counts, nothing else.
    expect(body.storage.bytes).toEqual(expect.any(Number))
    expect(body.storage.rows).toMatchObject({ contacts: expect.any(Number), campaigns: expect.any(Number) })
    expect((await get('/api/usage?month=2026-9', 'tok_123')).status).toBe(400)
  })

  it('gives each month a hit rate over lookups that reached a mail server', async () => {
    process.env.USAGE_API_TOKEN = 'tok_123'
    recordLookup('noDomain', new Date('2026-09-15T09:00:00Z'))
    recordLookup('limit', new Date('2026-09-15T09:00:00Z'))
    recordLookup('rejected', new Date('2026-09-15T09:00:00Z'))
    const body = await (await get('/api/usage?month=2026-09', 'tok_123')).json()
    // 1 verified out of verified + 2 catch-all + 1 rejected; noDomain and limit left out.
    expect(body.hitRate).toEqual({ verified: 1, checkable: 4, rate: 0.25 })
    const all = await (await get('/api/usage', 'tok_123')).json()
    expect(all.months[0].hitRate).toEqual({ verified: 0, checkable: 0, rate: null })
  })
})
