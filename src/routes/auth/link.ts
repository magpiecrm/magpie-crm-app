import { createFileRoute } from '@tanstack/react-router'

/**
 * One-time sign-in link from the hosting portal (see server/signInLink.ts):
 *   GET /auth/link?token=<token>
 * A good link starts a session and goes to the app; any other goes to the
 * sign-in page, which says what went wrong. Off (404) unless
 * SIGN_IN_LINK_SECRET is set.
 */

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

export const Route = createFileRoute('/auth/link')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await import('../../server/env')
        const secret = env.signIn.linkSecret()
        if (!secret) return new Response('Not found', { status: 404, headers })

        const { redeemSignInToken } = await import('../../server/signInLink')
        const { db } = await import('../../server/db')
        const token = new URL(request.url).searchParams.get('token') ?? ''
        const result = redeemSignInToken(token, secret, (email) => Boolean(db.findUser(email)))
        if (!result.ok) {
          console.warn(`[auth] sign-in link refused: ${result.reason}`)
          return new Response(null, { status: 303, headers: { ...headers, Location: `/login?link=${result.reason}` } })
        }

        const { sessionCookieHeader } = await import('../../server/auth.server')
        const user = db.findUser(result.email)!
        const sessionId = db.createSession(user.email)
        return new Response(null, {
          status: 303,
          headers: { ...headers, Location: '/collection', 'Set-Cookie': sessionCookieHeader(sessionId, request) },
        })
      },
    },
  },
})
