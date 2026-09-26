import { deleteCookie, getCookie, getRequest, setCookie } from '@tanstack/react-start/server'
import { db } from './db'

const SESSION_COOKIE = 'auth_token'
const WEEK_SECONDS = 7 * 24 * 60 * 60

/**
 * Validates the session token from the request cookies and retrieves the session.
 * Throws an error if unauthorized.
 */
export async function requireAuth() {
  const request = getRequest()
  if (!request) {
    throw new Error('Unauthorized: No active request')
  }
  const cookieHeader = request.headers.get('Cookie') || ''
  const match = cookieHeader.match(new RegExp(`(^|; )${SESSION_COOKIE}=([^;]+)`))
  const value = match ? decodeURIComponent(match[2]) : null

  if (!value) {
    throw new Error('Unauthorized: No session token')
  }

  const session = db.findSession(value)
  if (!session || new Date(session.expiresAt) < new Date()) {
    throw new Error('Unauthorized: Invalid or expired session')
  }

  return session
}


/**
 * The client's network address. Behind Caddy it's the first X-Forwarded-For
 * entry; null when there's no proxy to report it.
 */
export function clientAddress(): string | null {
  return getRequest()?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
}

/**
 * Sets the session cookie on the response: HttpOnly, so no script on the page
 * can read the token, and Secure when the site is served over https (directly
 * or behind a proxy that says so).
 */
export function setSessionCookie(sessionId: string) {
  const request = getRequest()
  const https = request?.headers.get('x-forwarded-proto') === 'https' || Boolean(request?.url.startsWith('https:'))
  setCookie(SESSION_COOKIE, sessionId, { httpOnly: true, secure: https, sameSite: 'lax', path: '/', maxAge: WEEK_SECONDS })
}

/**
 * The same session cookie as a Set-Cookie header value, for server routes
 * that build their own Response (e.g. /auth/link).
 */
export function sessionCookieHeader(sessionId: string, request: Request): string {
  const https = request.headers.get('x-forwarded-proto') === 'https' || request.url.startsWith('https:')
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${WEEK_SECONDS}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`
}

/** Ends this request's session on the server and clears its cookie. */
export function endSession() {
  const token = getCookie(SESSION_COOKIE)
  if (token) db.deleteSession(token)
  deleteCookie(SESSION_COOKIE, { path: '/' })
}
