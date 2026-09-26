import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'user-passwords-test-'))
const saved = { path: process.env.DATABASE_PATH, email: process.env.AUTH_EMAIL, password: process.env.AUTH_PASSWORD }
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.AUTH_EMAIL = 'admin@example.com'
process.env.AUTH_PASSWORD = 'first-password'

afterAll(() => {
  for (const [key, value] of [['DATABASE_PATH', saved.path], ['AUTH_EMAIL', saved.email], ['AUTH_PASSWORD', saved.password]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(scratchDir, { recursive: true, force: true })
})

/** A fresh db module over the same file, as after a server restart. */
async function restart() {
  vi.resetModules()
  return import('./db')
}

const passwordIs = async (password: string) => {
  const { db, verifyPassword } = await import('./db')
  return verifyPassword(password, db.findUser('admin@example.com')!.passwordHash)
}

describe('admin password from the environment', () => {
  it('creates the first login from AUTH_EMAIL and AUTH_PASSWORD', async () => {
    await restart()
    expect(await passwordIs('first-password')).toBe(true)
  })

  it('keeps a password changed in the app across restarts', async () => {
    const { db, hashPassword } = await import('./db')
    db.setUserPassword('admin@example.com', hashPassword('changed-in-app'))
    await restart()
    expect(await passwordIs('changed-in-app')).toBe(true)
  })

  it('lets a changed AUTH_PASSWORD reset it, e.g. to recover a lost password', async () => {
    process.env.AUTH_PASSWORD = 'recovery-password'
    await restart()
    expect(await passwordIs('recovery-password')).toBe(true)
    await restart()
    expect(await passwordIs('recovery-password')).toBe(true)
  })

  it('upgrades a login seeded before this was tracked without locking anyone out', async () => {
    const { db, hashPassword } = await import('./db')
    const user = db.findUser('admin@example.com')!
    user.passwordHash = hashPassword('recovery-password')
    delete user.envPasswordHash
    db.setUserPassword('admin@example.com', user.passwordHash)
    await restart()
    expect(await passwordIs('recovery-password')).toBe(true)
    expect((await import('./db')).db.findUser('admin@example.com')!.envPasswordHash).toBeTruthy()
  })
})

describe('sessions after a password change', () => {
  it('signs the user out everywhere except where they changed it', async () => {
    const { db } = await restart()
    const here = db.createSession('admin@example.com')
    const laptop = db.createSession('Admin@example.com')
    db.addUser('colleague@example.com', 'x:y')
    const colleague = db.createSession('colleague@example.com')
    db.deleteOtherSessions('admin@example.com', here)
    expect(db.findSession(here)).toBeTruthy()
    expect(db.findSession(laptop)).toBeNull()
    expect(db.findSession(colleague)).toBeTruthy()
  })
})
