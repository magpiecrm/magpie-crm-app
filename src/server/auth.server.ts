import { getRequest } from '@tanstack/react-start/server'
import { db } from './db'

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
  const match = cookieHeader.match(new RegExp('(^|; )auth_token=([^;]+)'))
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
