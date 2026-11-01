import { createFileRoute } from '@tanstack/react-router'

/**
 * One-time view-only link from the host's admin portal (see
 * server/signInLink.ts): GET /auth/view?token=<token>
 * A good link starts a read-only session and goes to the app; any other goes
 * to the sign-in page, which says what went wrong. Off (404) unless
 * SIGN_IN_LINK_SECRET is set.
 */

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

export const Route = createFileRoute('/auth/view')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await import('../../server/env')
        const secret = env.signIn.linkSecret()
        if (!secret) return new Response('Not found', { status: 404, headers })

        const { redeemViewOnlyToken } = await import('../../server/signInLink')
        const { db, VIEW_SESSION_SECONDS } = await import('../../server/db')
        const token = new URL(request.url).searchParams.get('token') ?? ''
        const result = redeemViewOnlyToken(token, secret)
        if (!result.ok) {
          console.warn(`[auth] view-only link refused: ${result.reason}`)
          return new Response(null, { status: 303, headers: { ...headers, Location: `/login?link=${result.reason}` } })
        }

        // The owner on the host's record may have left the team; anyone here shows the same workspace.
        const user = db.findUser(result.email) ?? db.getUsers()[0]
        if (!user) return new Response(null, { status: 303, headers: { ...headers, Location: '/login?link=unknown-user' } })

        const { sessionCookieHeader } = await import('../../server/auth.server')
        const sessionId = db.createViewSession(user.email, result.actor)
        return new Response(null, {
          status: 303,
          headers: { ...headers, Location: '/collection', 'Set-Cookie': sessionCookieHeader(sessionId, request, VIEW_SESSION_SECONDS) },
        })
      },
    },
  },
})
