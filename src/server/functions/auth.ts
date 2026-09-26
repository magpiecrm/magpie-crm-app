import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

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

/**
 * How people sign in here, for the sign-in page: with a password, or (when
 * PASSWORD_LOGIN=off) through the hosting provider's sign-in at `signInUrl`.
 */
export const signInOptionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { env } = await import('../env')
  return { passwordLogin: env.signIn.passwordLogin(), signInUrl: env.signIn.url() ?? null }
})

/**
 * Signs in with email and password. The session cookie is set on the
 * response as HttpOnly (see auth.server.ts), so the page never sees the
 * token. Wrong passwords are limited (see server/login.ts).
 */
export const loginFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string; password?: string }) =>
    z.object({ email: z.string().max(320), password: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { env } = await import('../env')
    if (!env.signIn.passwordLogin()) {
      return { success: false, error: 'Password sign-in is turned off here. Sign in through your hosting provider.' }
    }
    if (!data.password) {
      return { success: false, error: 'Password is required' }
    }
    const { clientAddress, setSessionCookie } = await import('../auth.server')
    const { db } = await import('../db')
    const { attemptLogin } = await import('../login')

    const result = attemptLogin(data.email, data.password, clientAddress(), {
      findUser: (email) => db.findUser(email),
      createSession: (email) => db.createSession(email),
    })
    if (!result.ok) return { success: false, error: result.error }
    setSessionCookie(result.sessionId)
    return { success: true }
  })

/** Signs out: ends the session on the server and clears the cookie. */
export const logoutFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { endSession } = await import('../auth.server')
  endSession()
  return { success: true }
})
