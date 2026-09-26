import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

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

    const { env } = await import('../env')
    if (!env.signIn.passwordLogin()) {
      return { success: false, error: 'Password sign-in is turned off here, so users are added by your hosting provider.' }
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

/**
 * Changes the signed-in user's own password. Needs the current one, so a
 * session left open on someone else's screen can't be used to lock the owner
 * out, and signs out that user's other sessions.
 */
export const changePasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { currentPassword: string; newPassword: string }) =>
    z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    let session
    try {
      const { requireAuth } = await import('../auth.server')
      session = await requireAuth()
    } catch (e) {
      return { success: false, error: 'Unauthorized' }
    }

    const { env } = await import('../env')
    if (!env.signIn.passwordLogin()) {
      return { success: false, error: 'Password sign-in is turned off here.' }
    }
    if (data.newPassword.trim().length < 6) {
      return { success: false, error: 'The new password must be at least 6 characters' }
    }
    const { db, hashPassword, verifyPassword } = await import('../db')
    const user = db.findUser(session.email)
    if (!user || !verifyPassword(data.currentPassword, user.passwordHash)) {
      return { success: false, error: 'Your current password is wrong' }
    }
    db.setUserPassword(user.email, hashPassword(data.newPassword))
    db.deleteOtherSessions(user.email, session.id)
    return { success: true }
  })
