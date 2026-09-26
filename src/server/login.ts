// Password sign-in rules, apart from the cookie handling in functions/auth.ts
// so they can be tested directly.
//
// - Wrong passwords are limited per email and per network address, so a
//   password can't be guessed by trying many. Counts are in memory: a
//   restart resets them, which only ever helps a real user.
// - An unknown email takes as long as a wrong password (the same scrypt
//   work), so timing doesn't reveal which emails have accounts.

import { hashPassword, verifyPassword } from './db'

const WINDOW_MS = 15 * 60_000
/** Wrong passwords for one email within the window before it's locked. */
const MAX_PER_EMAIL = 5
/** Wrong passwords from one address within the window, across emails. */
const MAX_PER_ADDRESS = 20

// globalThis so the counts survive Vite's module re-evaluation on HMR.
const g = globalThis as any
const failures: Map<string, number[]> = (g.__loginFailures ??= new Map())

/** A hash nobody's password matches, to spend the same time on unknown emails. */
let dummyHash: string | null = null

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length) failures.set(key, list)
  else failures.delete(key)
  return list
}

/** Minutes until the oldest counted failure drops out of the window. */
const minutesLeft = (list: number[], now: number) => Math.max(1, Math.ceil((list[0] + WINDOW_MS - now) / 60_000))

export interface LoginDeps {
  findUser(email: string): { email: string; passwordHash: string } | null
  createSession(email: string): string
  now?: () => number
}

export type LoginResult = { ok: true; sessionId: string; email: string } | { ok: false; error: string }

/**
 * `address` is the client's network address, or null when it isn't known
 * (no proxy in front to report it): then only the per-email limit applies,
 * since one shared "unknown" key would let anyone lock everyone out.
 */
export function attemptLogin(email: string, password: string, address: string | null, deps: LoginDeps): LoginResult {
  const now = deps.now?.() ?? Date.now()
  const emailKey = `email:${email.trim().toLowerCase()}`
  const addressKey = address ? `addr:${address}` : null

  const byEmail = recent(emailKey, now)
  const byAddress = addressKey ? recent(addressKey, now) : []
  if (byEmail.length >= MAX_PER_EMAIL || byAddress.length >= MAX_PER_ADDRESS) {
    const list = byEmail.length >= MAX_PER_EMAIL ? byEmail : byAddress
    const mins = minutesLeft(list, now)
    return { ok: false, error: `Too many wrong passwords. Try again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.` }
  }

  const user = email.trim() ? deps.findUser(email.trim()) : null
  const valid = user
    ? verifyPassword(password, user.passwordHash)
    : (verifyPassword(password, (dummyHash ??= hashPassword(crypto.randomUUID()))), false)

  if (!user || !valid) {
    failures.set(emailKey, [...byEmail, now])
    if (addressKey) failures.set(addressKey, [...byAddress, now])
    return { ok: false, error: 'Invalid email or password' }
  }

  failures.delete(emailKey)
  return { ok: true, sessionId: deps.createSession(user.email), email: user.email }
}

/** For tests: forget every counted failure. */
export function resetLoginLimits() {
  failures.clear()
}
