import { createServerFn } from '@tanstack/react-start'

export const checkAuthFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      const { requireAuth } = await import('../auth.server')
      const session = await requireAuth()
      return {
        isAuthenticated: true,
        email: session.email
      }
    } catch (e) {
      return {
        isAuthenticated: false
      }
    }
  })

export const loginFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string; password?: string }) => d)
  .handler(async ({ data }) => {
    const { email, password } = data
    if (!password) {
      return { success: false, error: 'Password is required' }
    }

    const { db, verifyPassword } = await import('../db')

    const user = db.findUser(email)
    if (!user) {
      return { success: false, error: 'Invalid email or password' }
    }

    const isValid = verifyPassword(password, user.passwordHash)
    if (!isValid) {
      return { success: false, error: 'Invalid email or password' }
    }

    const sessionId = db.createSession(email)

    return { success: true, token: sessionId }
  })

