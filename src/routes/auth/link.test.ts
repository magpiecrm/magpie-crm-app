import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'link-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { Route } = await import('./link')
const { db, hashPassword } = await import('../../server/db')
const { createSignInToken } = await import('../../server/signInLink')
const handlers = (Route as any).options.server.handlers

const secret = 'k'.repeat(64)
db.addUser('owner@acme.test', hashPassword('irrelevant'))

afterEach(() => {
  delete process.env.SIGN_IN_LINK_SECRET
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const get = (token: string, proto = 'https') =>
  handlers.GET({
    request: new Request(`http://acme.test/auth/link?token=${encodeURIComponent(token)}`, {
      headers: { 'x-forwarded-proto': proto },
    }),
  }) as Promise<Response>

describe('GET /auth/link', () => {
  it('is off unless SIGN_IN_LINK_SECRET is set', async () => {
    expect((await get(createSignInToken('owner@acme.test', secret))).status).toBe(404)
  })

  it('starts a session for a good link', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const res = await get(createSignInToken('owner@acme.test', secret))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/collection')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toMatch(/^auth_token=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/)
    const sessionId = decodeURIComponent(cookie.split(';')[0].split('=')[1])
    expect(db.findSession(sessionId)?.email).toBe('owner@acme.test')
  })

  it('sends a bad link to the sign-in page with the reason', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const token = createSignInToken('owner@acme.test', secret)
    await get(token)
    const again = await get(token)
    expect(again.status).toBe(303)
    expect(again.headers.get('location')).toBe('/login?link=used')
    expect(again.headers.get('set-cookie')).toBeNull()

    expect((await get(createSignInToken('stranger@acme.test', secret))).headers.get('location')).toBe('/login?link=unknown-user')
    expect((await get('nonsense')).headers.get('location')).toBe('/login?link=invalid')
  })
})
