import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'view-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { Route } = await import('./view')
const { db, hashPassword } = await import('../../server/db')
const { isViewOnly, sessionFrom } = await import('../../server/auth.server')
const { createSignInToken, createViewOnlyToken } = await import('../../server/signInLink')
const handlers = (Route as any).options.server.handlers

const secret = 'k'.repeat(64)
const staff = 'staff@host.test'
db.addUser('owner@acme.test', hashPassword('irrelevant'))

afterEach(() => {
  delete process.env.SIGN_IN_LINK_SECRET
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const get = (token: string) =>
  handlers.GET({
    request: new Request(`http://acme.test/auth/view?token=${encodeURIComponent(token)}`, { headers: { 'x-forwarded-proto': 'https' } }),
  }) as Promise<Response>

const opened = async (email = 'owner@acme.test') => {
  const res = await get(createViewOnlyToken(email, staff, secret))
  return { res, sessionId: decodeURIComponent(res.headers.get('set-cookie')!.split(';')[0].split('=')[1]) }
}

describe('GET /auth/view', () => {
  it('is off unless SIGN_IN_LINK_SECRET is set', async () => {
    expect((await get(createViewOnlyToken('owner@acme.test', staff, secret))).status).toBe(404)
  })

  it('starts a read-only session for an hour, kept apart from ordinary sessions', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const { res, sessionId } = await opened()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/collection')
    expect(res.headers.get('set-cookie')).toMatch(/^auth_token=[^;]+; Path=\/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure$/)

    const session = db.findSession(sessionId)!
    expect(session).toMatchObject({ email: 'owner@acme.test', viewOnlyBy: staff })
    expect(Date.parse(session.expiresAt) - Date.now()).toBeLessThanOrEqual(3600_000)
    // What an older version reads, after a rollback: it must not find this one.
    expect(db.data.sessions.some((s) => s.id === sessionId)).toBe(false)
  })

  it('shows as the first user when the owner on record has left the team', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const { sessionId } = await opened('gone@acme.test')
    expect(db.findSession(sessionId)).toMatchObject({ email: 'owner@acme.test', viewOnlyBy: staff })
  })

  it('sends a bad link to the sign-in page with the reason', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const res = await get(createSignInToken('owner@acme.test', secret))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login?link=invalid')
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('view-only sessions', () => {
  const asking = (sessionId: string) => new Request('http://acme.test/', { headers: { Cookie: `auth_token=${encodeURIComponent(sessionId)}` } })

  it('are told apart from ordinary ones', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const { sessionId } = await opened()
    expect(isViewOnly(sessionFrom(asking(sessionId)))).toBe(true)
    expect(isViewOnly(sessionFrom(asking(db.createSession('owner@acme.test'))))).toBe(false)
    expect(isViewOnly(sessionFrom(new Request('http://acme.test/')))).toBe(false)
  })

  it('stop after the hour, and are dropped when the next one opens', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const { sessionId } = await opened()
    db.data.view_sessions!.find((s) => s.id === sessionId)!.expiresAt = new Date(Date.now() - 1000).toISOString()
    expect(sessionFrom(asking(sessionId))).toBeNull()
    await opened()
    expect(db.findSession(sessionId)).toBeNull()
  })

  it('end on sign-out and when the password changes', async () => {
    process.env.SIGN_IN_LINK_SECRET = secret
    const signedOut = (await opened()).sessionId
    db.deleteSession(signedOut)
    expect(db.findSession(signedOut)).toBeNull()

    const passwordChanged = (await opened()).sessionId
    db.deleteOtherSessions('owner@acme.test', 'another-session')
    expect(db.findSession(passwordChanged)).toBeNull()
  })

  it('treat a cookie that cannot be decoded as no session', () => {
    expect(sessionFrom(new Request('http://acme.test/', { headers: { Cookie: 'auth_token=%E0%A4%A' } }))).toBeNull()
  })
})
