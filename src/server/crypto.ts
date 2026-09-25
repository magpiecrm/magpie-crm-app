import crypto from 'crypto'
import { env } from './env'

// We need a 32-byte key. We hash the secret to derive a secure key.
// Callers may pass their own secret — provider credentials use a dedicated one
// (env.credentialsSecret) so rotating the tracking secret does not orphan them.
const getKey = (secret?: string) => {
  return crypto.createHash('sha256').update(secret ?? env.trackingSecret()).digest()
}

/**
 * Encrypts a JSON payload into a secure token.
 */
export function encryptToken(data: Record<string, any>, secret?: string): string {
  const key = getKey(secret)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  // Return IV, encrypted data, and authentication tag as a colon-separated string
  return `${iv.toString('hex')}:${encrypted}:${tag}`
}

/**
 * Decrypts and validates a secure token back into a JSON payload.
 * Returns null if the token has been tampered with or is invalid.
 */
export function decryptToken(token: string, secret?: string): Record<string, any> | null {
  try {
    const key = getKey(secret)
    const parts = token.split(':')
    if (parts.length !== 3) return null
    const [ivHex, encryptedHex, tagHex] = parts
    
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return JSON.parse(decrypted)
  } catch (err) {
    return null
  }
}
