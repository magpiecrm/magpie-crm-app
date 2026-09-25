import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../../server/db'
import { getAppUrl } from '../../../../server/appUrl'
import { issueEmbedToken } from '../../../../server/surveyEmbed'
import { clientIp, createRateLimiter } from '../../../../server/rateLimit'

const allow = createRateLimiter({ limit: 300, windowMs: 60_000 })

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Server-to-server: another app's backend exchanges its API key and a signed-in
 * user's email for a personal embed URL. No CORS headers on purpose — the API
 * key must never be sent from a browser.
 */
export const Route = createFileRoute('/api/surveys/$surveyId/token')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { surveyId: string } }) => {
        const apiKey = request.headers.get('X-API-Key')
        if (!apiKey || !db.verifyApiKey(apiKey)) return json(401, { error: 'Unauthorized' })
        if (!allow(`${clientIp(request)}:embed-token`)) return json(429, { error: 'Too many requests' })

        let body: any
        try {
          body = await request.json()
        } catch {
          return json(400, { error: 'Invalid JSON' })
        }

        const result = issueEmbedToken({
          surveyId: params.surveyId,
          email: body?.email,
          firstName: body?.firstName,
          lastName: body?.lastName,
          appUrl: await getAppUrl(),
        })
        return json(result.status, result.body)
      },
    },
  },
})
