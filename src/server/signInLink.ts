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
//
// A view-only link, for the host's staff looking at a copy from their admin
// portal, goes to GET /auth/view with an extra claim and its own signature:
//
//   payload   = JSON { "email": "...", "actor": "<staff email>", "exp": ..., "nonce": "..." }
//   signature = HMAC-SHA256(SIGN_IN_LINK_SECRET, "view-only." + <payload as sent>)
//
// The signature's prefix is what makes it safe: a version that doesn't know
// about these links refuses one as a bad signature, where it would ignore an
// extra claim on an ordinary link and give a full session. Its session can
// read and can't change anything (src/start.ts).

import crypto from 'crypto'

/** The longest a link may be valid for, whatever its exp says. */
const MAX_LINK_SECONDS = 120
/** Shorter secrets are refused, so a weak one can't be brute-forced from a captured link. */
const MIN_SECRET_LENGTH = 32

// globalThis so used nonces survive Vite's module re-evaluation on HMR.
const g = globalThis as any
const used: Map<string, number> = (g.__signInLinkNonces ??= new Map())

/** What a view-only link's signature covers ahead of its payload. */
const VIEW_ONLY_PREFIX = 'view-only.'

const sign = (secret: string, payload: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url')

const payloadOf = (claims: { email: string; actor?: string }, now: number, ttlSeconds: number) =>
  Buffer.from(
    JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + ttlSeconds, nonce: crypto.randomBytes(16).toString('base64url') }),
  ).toString('base64url')

/** Makes a link token; for the hosting portal's side and for tests. */
export function createSignInToken(email: string, secret: string, now = Date.now(), ttlSeconds = 60): string {
  const payload = payloadOf({ email }, now, ttlSeconds)
  return `${payload}.${sign(secret, payload)}`
}

/** Makes a view-only link token; for the hosting portal's side and for tests. */
export function createViewOnlyToken(email: string, actor: string, secret: string, now = Date.now(), ttlSeconds = 60): string {
  const payload = payloadOf({ email, actor }, now, ttlSeconds)
  return `${payload}.${sign(secret, VIEW_ONLY_PREFIX + payload)}`
}

type Refused<Reason extends string> = { ok: false; reason: Reason }
export type SignInLinkResult = { ok: true; email: string } | Refused<'invalid' | 'expired' | 'used' | 'unknown-user'>
export type ViewOnlyLinkResult = { ok: true; email: string; actor: string } | Refused<'invalid' | 'expired' | 'used'>

/** Checks a token, its signature covering `prefix` + payload, and if it's good, uses it up. */
function spendToken(
  token: string,
  secret: string,
  prefix: string,
  now: number,
): { ok: true; email: string; actor: unknown } | Refused<'invalid' | 'expired' | 'used'> {
  if (secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'invalid' }
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return { ok: false, reason: 'invalid' }

  const expected = Buffer.from(sign(secret, prefix + payload))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' }

  let claims: { email?: unknown; actor?: unknown; exp?: unknown; nonce?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const { email, actor, exp, nonce } = claims
  if (typeof email !== 'string' || typeof exp !== 'number' || typeof nonce !== 'string' || nonce.length < 16) {
    return { ok: false, reason: 'invalid' }
  }

  const seconds = Math.floor(now / 1000)
  if (exp < seconds || exp > seconds + MAX_LINK_SECONDS) return { ok: false, reason: 'expired' }

  for (const [n, until] of used) if (until < seconds) used.delete(n)
  if (used.has(nonce)) return { ok: false, reason: 'used' }
  used.set(nonce, exp)

  return { ok: true, email, actor }
}

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
  const result = spendToken(token, secret, '', now)
  if (!result.ok) return result
  if (!isUser(result.email)) return { ok: false, reason: 'unknown-user' }
  return { ok: true, email: result.email }
}

/**
 * Checks a view-only link token and, if it's good, uses it up. `email` isn't
 * checked against the users here: the owner the host has on record may have
 * been removed from the team, and the caller picks who the session shows as.
 */
export function redeemViewOnlyToken(token: string, secret: string, now = Date.now()): ViewOnlyLinkResult {
  const result = spendToken(token, secret, VIEW_ONLY_PREFIX, now)
  if (!result.ok) return result
  if (typeof result.actor !== 'string' || !result.actor.includes('@')) return { ok: false, reason: 'invalid' }
  return { ok: true, email: result.email, actor: result.actor }
}

/** For tests: forget used links. */
export function resetSignInLinks() {
  used.clear()
}
