import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// login.ts imports db.ts for password hashing; keep it off the real database.
const scratchDir = mkdtempSync(join(tmpdir(), 'login-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { hashPassword } = await import('./db')
const { attemptLogin, resetLoginLimits } = await import('./login')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const user = { email: 'owner@acme.test', passwordHash: hashPassword('right-password') }
let now = 1_000_000
const deps = {
  findUser: (email: string) => (email.toLowerCase() === user.email ? user : null),
  createSession: () => 'session-1',
  now: () => now,
}

beforeEach(() => {
  resetLoginLimits()
  now = 1_000_000
})

describe('attemptLogin', () => {
  it('signs in with the right password, whatever the email case', () => {
    expect(attemptLogin('Owner@Acme.test', 'right-password', '1.1.1.1', deps)).toEqual({ ok: true, sessionId: 'session-1', email: user.email })
  })

  it('gives the same answer for an unknown email and a wrong password', () => {
    const unknown = attemptLogin('nobody@acme.test', 'x', '1.1.1.1', deps)
    const wrong = attemptLogin(user.email, 'x', '1.1.1.1', deps)
    expect(unknown).toEqual(wrong)
  })

  it('locks an email after 5 wrong passwords, even with the right one, for 15 minutes', () => {
    for (let i = 0; i < 5; i++) attemptLogin(user.email, 'guess', `10.0.0.${i}`, deps)
    const locked = attemptLogin(user.email, 'right-password', '10.0.0.99', deps)
    expect(locked).toEqual({ ok: false, error: 'Too many wrong passwords. Try again in 15 minutes.' })
    now += 15 * 60_000
    expect(attemptLogin(user.email, 'right-password', '10.0.0.99', deps).ok).toBe(true)
  })

  it('limits one address trying many emails', () => {
    for (let i = 0; i < 20; i++) attemptLogin(`user${i}@acme.test`, 'guess', '6.6.6.6', deps)
    expect(attemptLogin(user.email, 'right-password', '6.6.6.6', deps).ok).toBe(false)
    expect(attemptLogin(user.email, 'right-password', '7.7.7.7', deps).ok).toBe(true)
  })

  it('without a known address, only the per-email limit applies', () => {
    for (let i = 0; i < 30; i++) attemptLogin(`user${i}@acme.test`, 'guess', null, deps)
    expect(attemptLogin(user.email, 'right-password', null, deps).ok).toBe(true)
  })

  it('forgets earlier wrong passwords after signing in', () => {
    for (let i = 0; i < 4; i++) attemptLogin(user.email, 'guess', '1.1.1.1', deps)
    expect(attemptLogin(user.email, 'right-password', '1.1.1.1', deps).ok).toBe(true)
    for (let i = 0; i < 4; i++) attemptLogin(user.email, 'guess', '1.1.1.1', deps)
    expect(attemptLogin(user.email, 'right-password', '1.1.1.1', deps).ok).toBe(true)
  })
})
