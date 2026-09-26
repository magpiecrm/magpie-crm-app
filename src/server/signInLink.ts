// One-time sign-in links, for a copy whose sign-in is run by whoever hosts it
// (e.g. MagpieCRM Cloud, where people sign in once on the hosting provider's
// portal). The portal holds SIGN_IN_LINK_SECRET too, and sends a signed-in
// person to
//
//   GET /auth/link?token=<token>
//
// where token = <payload>.<signature>, both base64url:
//   payload   = JSON { "email": "...", "exp": <unix seconds>, "nonce": "<random>" }
//   signature = HMAC-SHA256(SIGN_IN_LINK_SECRET, <payload as sent>)
//
// A link works once, only for an email that's already a user of this copy,
// and for at most two minutes, so one found in a browser history or a log is
// useless.

import crypto from 'crypto'

/** The longest a link may be valid for, whatever its exp says. */
const MAX_LINK_SECONDS = 120
/** Shorter secrets are refused, so a weak one can't be brute-forced from a captured link. */
const MIN_SECRET_LENGTH = 32

// globalThis so used nonces survive Vite's module re-evaluation on HMR.
const g = globalThis as any
const used: Map<string, number> = (g.__signInLinkNonces ??= new Map())

const sign = (secret: string, payload: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url')

/** Makes a link token; for the hosting portal's side and for tests. */
export function createSignInToken(email: string, secret: string, now = Date.now(), ttlSeconds = 60): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(now / 1000) + ttlSeconds, nonce: crypto.randomBytes(16).toString('base64url') }),
  ).toString('base64url')
  return `${payload}.${sign(secret, payload)}`
}

export type SignInLinkResult = { ok: true; email: string } | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'unknown-user' }

/**
 * Checks a link token and, if it's good, uses it up. `isUser` says whether an
 * email is a user of this copy.
 */
export function redeemSignInToken(
  token: string,
  secret: string,
  isUser: (email: string) => boolean,
  now = Date.now(),
): SignInLinkResult {
  if (secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'invalid' }
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return { ok: false, reason: 'invalid' }

  const expected = Buffer.from(sign(secret, payload))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' }

  let claims: { email?: unknown; exp?: unknown; nonce?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const { email, exp, nonce } = claims
  if (typeof email !== 'string' || typeof exp !== 'number' || typeof nonce !== 'string' || nonce.length < 16) {
    return { ok: false, reason: 'invalid' }
  }

  const seconds = Math.floor(now / 1000)
  if (exp < seconds || exp > seconds + MAX_LINK_SECONDS) return { ok: false, reason: 'expired' }

  for (const [n, until] of used) if (until < seconds) used.delete(n)
  if (used.has(nonce)) return { ok: false, reason: 'used' }
  used.set(nonce, exp)

  if (!isUser(email)) return { ok: false, reason: 'unknown-user' }
  return { ok: true, email }
}

/** For tests: forget used links. */
export function resetSignInLinks() {
  used.clear()
}
