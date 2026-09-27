import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'suppressions-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.SUPPRESSION_SECRET = 'shared-by-every-copy'

const deleted: string[][] = []
vi.mock('../../server/emailService', () => ({
  deleteContacts: async (emails: string[]) => {
    const { db } = await import('../../server/db')
    db.data.contacts = db.data.contacts.filter((c) => !emails.includes(c.email))
    deleted.push(emails)
  },
}))

const { Route } = await import('./usage.suppressions')
const { db } = await import('../../server/db')
const { hashesFor, processOptOut } = await import('../../server/prospecting/suppression')
const handlers = (Route as any).options.server.handlers

const TOKEN = 'ut_host'
beforeEach(() => {
  process.env.USAGE_API_TOKEN = TOKEN
  db.data.suppression = []
  db.data.disclosure_log = []
  db.data.contacts = []
  deleted.length = 0
})
afterEach(() => {
  delete process.env.USAGE_API_TOKEN
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  delete process.env.SUPPRESSION_SECRET
  rmSync(scratchDir, { recursive: true, force: true })
})

const get = (query = '', token = TOKEN) =>
  handlers.GET({ request: new Request(`http://app.test/api/usage/suppressions${query}`, { headers: { authorization: `Bearer ${token}` } }) })
const post = (body: unknown, token = TOKEN) =>
  handlers.POST({
    request: new Request('http://app.test/api/usage/suppressions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })

describe('opt-outs passed between copies', () => {
  it('is off without a usage token, and refuses the wrong one', async () => {
    delete process.env.USAGE_API_TOKEN
    expect((await get()).status).toBe(404)
    process.env.USAGE_API_TOKEN = TOKEN
    expect((await get('', 'nope')).status).toBe(401)
    expect((await post({ entries: [] }, 'nope')).status).toBe(401)
  })

  it("lists this copy's own opt-outs since a time, as hashes only", async () => {
    await processOptOut({ email: 'Jane@Acme.test' })
    const first = await (await get()).json()
    expect(first.entries).toEqual([{ kind: 'email', hash: hashesFor({ email: 'jane@acme.test' })[0].hash, created_at: expect.any(String) }])
    expect(JSON.stringify(first)).not.toContain('jane')
    expect((await (await get(`?since=${encodeURIComponent(first.until)}`)).json()).entries).toEqual([])
    expect((await get('?since=yesterday')).status).toBe(400)
  })

  it("takes opt-outs from another copy, deletes the matching contact, and doesn't list them back", async () => {
    db.data.contacts = [{ email: 'jane@acme.test', first_name: 'Jane', last_name: 'Smith' } as any, { email: 'bob@acme.test', first_name: 'Bob', last_name: 'Jones' } as any]
    // Another copy with the same SUPPRESSION_SECRET hashed Jane's name at acme.test.
    const theirs = hashesFor({ firstName: 'Jane', lastName: 'Smith', domain: 'acme.test' }, 'shared-by-every-copy')
    const res = await (await post({ entries: theirs })).json()
    expect(res).toEqual({ added: 1, removed: 1 })
    expect(deleted).toEqual([['jane@acme.test']])
    expect(db.getSuppressionHashes().has(hashesFor({ email: 'jane@acme.test' })[0].hash)).toBe(true)
    expect((await (await get()).json()).entries).toEqual([])
    expect(await (await post({ entries: theirs })).json()).toEqual({ added: 0, removed: 0 })
  })

  it('refuses anything that is not a list of hashes', async () => {
    expect((await post({ entries: [{ kind: 'email', hash: 'jane@acme.test' }] })).status).toBe(400)
    expect((await post({ entries: [{ kind: 'phone', hash: 'a'.repeat(64) }] })).status).toBe(400)
    expect((await post({ nope: true })).status).toBe(400)
  })
})
