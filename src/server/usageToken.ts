import crypto from 'crypto'
import { env } from './env'

/**
 * Whether the request carries this copy's USAGE_API_TOKEN (the host's key to
 * /api/usage and /api/usage/allowance). False when no token is configured.
 */
export function hasUsageToken(request: Request): boolean {
  const expected = env.usageApiToken()
  if (!expected) return false
  const auth = request.headers.get('authorization') ?? ''
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!given) return false
  // Compare digests so the check takes the same time whatever the length.
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}
