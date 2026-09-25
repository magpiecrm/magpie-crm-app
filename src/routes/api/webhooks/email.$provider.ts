import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { env } from '../../../server/env'
import { PROVIDERS } from '../../../server/providers'
import { isProviderId } from '../../../server/providers/descriptors'

// Per-provider bounce webhooks. Cloudflare is the odd one out — its bounces are
// polled from the GraphQL analytics dataset in bouncePoller.ts — but every
// other provider pushes events here, so switching provider does not silently
// stop bounce tracking.
//
// Point the provider at:  {PUBLIC_URL}/api/webhooks/email/{provider}
//
// Auth reuses the existing optional WEBHOOK_SECRET shared-secret gate, accepted
// either as a bearer token or a `?s=` query param since not every provider can
// send custom headers. Per-provider signature verification (Mailgun HMAC,
// Resend svix, SNS certificates) is the stronger long-term check and is not
// implemented yet — set WEBHOOK_SECRET to keep the endpoint from being open.

function authorized(request: Request): boolean {
  const secret = env.webhookSecret()
  if (!secret) return true
  const authHeader = request.headers.get('Authorization')
  if (authHeader === `Bearer ${secret}`) return true
  return new URL(request.url).searchParams.get('s') === secret
}

/**
 * Mandrill posts form-encoded data with the events in a `mandrill_events`
 * field; everyone else posts JSON.
 */
async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData()
    const raw = form.get('mandrill_events')
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    return Object.fromEntries(form.entries())
  }
  return request.json()
}

export const Route = createFileRoute('/api/webhooks/email/$provider')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { provider: string } }) => {
        try {
          if (!authorized(request)) {
            console.warn(`[WEBHOOK] Unauthorized ${params.provider} webhook attempt`)
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          const providerId = params.provider
          if (!isProviderId(providerId)) {
            return Response.json({ error: `Unknown provider: ${providerId}` }, { status: 404 })
          }

          const parseWebhook = PROVIDERS[providerId].parseWebhook
          if (!parseWebhook) {
            return Response.json(
              { error: `${providerId} does not deliver bounces by webhook` },
              { status: 400 },
            )
          }

          const body = await readBody(request)

          // SES subscribes over SNS, which first sends a confirmation request
          // that must be fetched or the topic never activates.
          const subscribeUrl = (body as any)?.SubscribeURL
          if (subscribeUrl && (body as any)?.Type === 'SubscriptionConfirmation') {
            await fetch(subscribeUrl)
            console.log(`[WEBHOOK] Confirmed ${providerId} SNS subscription`)
            return Response.json({ success: true, confirmed: true })
          }

          const bounces = parseWebhook(body)
          for (const bounce of bounces) {
            console.log(
              `[WEBHOOK] ${providerId} ${bounce.type} bounce for ${bounce.email}` +
                (bounce.reason ? ` (${bounce.reason})` : ''),
            )
            // Deliberately no campaignId: updateRecipientBounceStatus already
            // falls back to the most recent `sent` row, which saves threading
            // X-Campaign-ID back out of eight different payload shapes.
            db.updateRecipientBounceStatus(bounce.email, bounce.type)
          }

          return Response.json({ success: true, processed: bounces.length })
        } catch (err: any) {
          console.error('[WEBHOOK] Failed to process bounce webhook:', err)
          return Response.json({ error: err.message }, { status: 500 })
        }
      },
    },
  },
})
