import { createServerFn } from '@tanstack/react-start'

// Get all active API keys (masked for UI)
export const getApiKeysFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    try {
      const { db } = await import('../db')
      const keys = db.getApiKeys()
      return { success: true, keys }
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to fetch API keys' }
    }
  })

// Create and hash a new API key
export const createApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    const { name } = data
    if (!name || !name.trim()) {
      return { success: false, error: 'Name is required' }
    }

    try {
      const crypto = await import('crypto')
      const { db } = await import('../db')
      // Generate a secure raw API key
      const rawRandomBytes = crypto.randomBytes(24).toString('hex')
      const rawKey = `vtl_${rawRandomBytes}`
      
      // Hash the key using SHA-256
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex')
      
      // Mask the key: vtl_abc...wxyz
      const maskedKey = `${rawKey.slice(0, 7)}****************${rawKey.slice(-4)}`

      // Add to database
      db.addApiKey(name.trim(), hash, maskedKey)

      // Return the rawKey only ONCE during creation
      return { success: true, rawKey }
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to generate API key' }
    }
  })

// Revoke/Delete an API key by ID
export const deleteApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    const { id } = data
    if (!id) {
      return { success: false, error: 'ID is required' }
    }

    try {
      const { db } = await import('../db')
      db.deleteApiKey(id)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to delete API key' }
    }
  })
