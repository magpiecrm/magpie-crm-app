import { createFileRoute } from '@tanstack/react-router'
import { submitSurveyPage } from '../../../server/surveyResponses'
import { clientIp, createRateLimiter } from '../../../server/rateLimit'
import type { ResponseSource } from '../../../features/survey-builder/types'

const MAX_BODY_BYTES = 64 * 1024
const SOURCES: ResponseSource[] = ['email', 'email_inline', 'link', 'embed', 'qr']
const allow = createRateLimiter({ limit: 60, windowMs: 60_000 })

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Public survey submit endpoint, one POST per page. Deliberately unauthenticated;
 * identity comes from the per-recipient token or the anonymous resume key.
 * Same-origin only (embeds are iframes of the hosted page), so no CORS headers.
 */
export const Route = createFileRoute('/api/survey/$surveyId')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { surveyId: string } }) => {
        if (!allow(`${clientIp(request)}:${params.surveyId}`)) {
          return json(429, { error: 'Too many requests. Please wait a minute and try again.' })
        }

        const raw = await request.text()
        if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Response too large' })

        let body: any
        try {
          body = JSON.parse(raw)
        } catch {
          return json(400, { error: 'Invalid JSON' })
        }
        if (!body || typeof body !== 'object' || typeof body.pageId !== 'string') return json(400, { error: 'Invalid request' })

        // Honeypot: pretend it worked so bots don't learn anything.
        if (typeof body.hp === 'string' && body.hp) {
          return json(200, { responseId: 'ok', next: { kind: 'end' }, completed: true })
        }

        const result = submitSurveyPage({
          surveyId: params.surveyId,
          t: typeof body.t === 'string' ? body.t : null,
          resumeKey: typeof body.resumeKey === 'string' ? body.resumeKey : null,
          source: SOURCES.includes(body.source) ? body.source : 'link',
          pageId: body.pageId,
          answers: body.answers && typeof body.answers === 'object' ? body.answers : {},
          startedAt: typeof body.startedAt === 'number' ? body.startedAt : undefined,
          referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
        })
        return json(result.status, result.body)
      },
    },
  },
})
