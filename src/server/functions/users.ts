import { createServerFn } from '@tanstack/react-start'

export const getUsersFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    try {
      const { db } = await import('../db')
      const users = db.getUsers()
      return { success: true, users }
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to fetch users' }
    }
  })

export const createUserFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string; password?: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    const { email, password } = data
    if (!email || !email.trim()) {
      return { success: false, error: 'Email is required' }
    }
    if (!password || !password.trim()) {
      return { success: false, error: 'Password is required' }
    }
    if (password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters' }
    }

    try {
      const { db, hashPassword } = await import('../db')
      const hash = hashPassword(password)
      db.addUser(email, hash)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to create user' }
    }
  })

export const deleteUserFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    let session
    try {
      const { requireAuth } = await import('../auth.server')
      session = await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    const { email } = data
    if (!email) {
      return { success: false, error: 'Email is required' }
    }

    if (session.email.toLowerCase() === email.toLowerCase().trim()) {
      return { success: false, error: 'Cannot delete your own user account' }
    }

    try {
      const { db } = await import('../db')
      db.deleteUser(email)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to delete user' }
    }
  })
