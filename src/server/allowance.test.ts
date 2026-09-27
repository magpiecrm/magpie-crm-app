import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'allowance-test-'))
const dbFile = join(scratchDir, 'local_db.json')
process.env.DATABASE_PATH = dbFile

const { setAllowance, clearAllowance, getAllowance, remaining, requireAllowance, AllowanceError } = await import('./allowance')
const { recordUsage, getUsage } = await import('./usage')
const { Route } = await import('../routes/api/usage.allowance')
const handlers = (Route as any).options.server.handlers

const originalToken = process.env.USAGE_API_TOKEN
afterEach(() => {
  clearAllowance()
  if (originalToken === undefined) delete process.env.USAGE_API_TOKEN
  else process.env.USAGE_API_TOKEN = originalToken
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const period = { periodStart: '2026-10-15T00:00:00Z', periodEnd: '2026-11-15T00:00:00Z', upgradeUrl: 'https://app.host.test/billing' }

describe('allowances', () => {
  it('means no limits until a host sets one', () => {
    expect(getAllowance()).toBeNull()
    expect(remaining('prospects')).toBe(Infinity)
    expect(() => requireAllowance('emailsSent', 1_000_000)).not.toThrow()
  })

  it('counts usage against each allowance separately', () => {
    setAllowance({ ...period, prospects: 100, reveals: 10 })
    recordUsage({ searches: 1, prospects: 25, prospectCredits: 25, emailLookups: 3, emailsFound: 2, emailsSent: 500 })
    expect(remaining('prospects')).toBe(75)
    expect(remaining('reveals')).toBe(8)
    // No limit set for emails.
    expect(remaining('emailsSent')).toBe(Infinity)
    // The usage counts themselves are unchanged.
    expect(getUsage().at(-1)).toMatchObject({ prospects: 25, emailsFound: 2, emailsSent: 500 })
  })

  it('keeps what was used on an upgrade, and starts again in a new period', () => {
    setAllowance({ ...period, prospects: 100 })
    recordUsage({ prospectCredits: 90 })
    setAllowance({ ...period, prospects: 300 })
    expect(remaining('prospects')).toBe(210)
    setAllowance({ ...period, periodStart: '2026-11-15T00:00:00Z', prospects: 300 })
    expect(remaining('prospects')).toBe(300)
  })

  it('refuses what would go over, saying how much is left', () => {
    setAllowance({ ...period, emailsSent: 1000 })
    recordUsage({ emailsSent: 650 })
    expect(() => requireAllowance('emailsSent', 350)).not.toThrow()
    let err: any
    try {
      requireAllowance('emailsSent', 2000, 'Sending this campaign')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AllowanceError)
    expect(err.message).toBe('Sending this campaign needs 2,000 emails, but your plan has 350 left this month. Upgrade to get more.')
    expect(err.upgradeUrl).toBe('https://app.host.test/billing')

    recordUsage({ emailsSent: 350 })
    expect(() => requireAllowance('emailsSent', 1)).toThrow("You've used all 1,000 emails in your plan this month. Upgrade to get more.")
  })

  it("pauses sending when the host says so, whatever's left, and leaves the rest alone", () => {
    setAllowance({ ...period, prospects: 100, emailsSent: 10000, sendingPaused: true })
    expect(remaining('emailsSent')).toBe(0)
    expect(remaining('prospects')).toBe(100)
    expect(() => requireAllowance('emailsSent', 1, 'Sending this campaign')).toThrow('Sending is paused on this workspace by your hosting provider')
    setAllowance({ ...period, prospects: 100, emailsSent: 10000 })
    expect(remaining('emailsSent')).toBe(10000)
  })

  it('is saved with the usage counts', async () => {
    setAllowance({ ...period, reveals: 50 })
    recordUsage({ emailsFound: 4 })
    getUsage() // writes pending counts
    expect(JSON.parse(readFileSync(dbFile, 'utf8')).allowance).toMatchObject({ limits: { reveals: 50 }, used: { reveals: 4 } })
  })
})

const call = (method: 'GET' | 'PUT' | 'DELETE', token?: string, body?: unknown) =>
  handlers[method]({
    request: new Request('http://app.test/api/usage/allowance', {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  }) as Promise<Response>

describe('/api/usage/allowance', () => {
  it('is off unless USAGE_API_TOKEN is set, and needs the token', async () => {
    delete process.env.USAGE_API_TOKEN
    expect((await call('GET', 'x')).status).toBe(404)
    process.env.USAGE_API_TOKEN = 'tok_123'
    expect((await call('GET')).status).toBe(401)
    expect((await call('PUT', 'wrong', { ...period, prospects: 1 })).status).toBe(401)
    expect(getAllowance()).toBeNull()
  })

  it('sets, shows and removes the allowance', async () => {
    process.env.USAGE_API_TOKEN = 'tok_123'
    const put = await call('PUT', 'tok_123', { ...period, prospects: 500, reveals: 1500, emailsSent: 10000 })
    expect(put.status).toBe(200)
    expect((await put.json()).allowance).toMatchObject({ limits: { prospects: 500, reveals: 1500, emailsSent: 10000 }, used: { prospects: 0 } })
    recordUsage({ prospectCredits: 7 })
    expect((await (await call('GET', 'tok_123')).json()).allowance.used.prospects).toBe(7)
    expect((await call('DELETE', 'tok_123')).status).toBe(200)
    expect(remaining('prospects')).toBe(Infinity)
  })

  it('refuses a malformed allowance', async () => {
    process.env.USAGE_API_TOKEN = 'tok_123'
    for (const bad of [{ prospects: 5 }, { ...period, prospects: -1 }, { ...period, reveals: 1.5 }, { ...period, upgradeUrl: 'http://insecure.test' }]) {
      expect((await call('PUT', 'tok_123', bad)).status).toBe(400)
    }
    expect(getAllowance()).toBeNull()
  })
})
