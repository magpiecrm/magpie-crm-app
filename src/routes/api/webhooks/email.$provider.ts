import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { webhookAuth, webhookRefusal } from '../../../server/webhookAuth'
import { PROVIDERS } from '../../../server/providers'
import { isProviderId } from '../../../server/providers/descriptors'
import { isSnsUrl } from '../../../server/providers/ses'

// Per-provider bounce webhooks. Cloudflare is the odd one out — its bounces are
// polled from the GraphQL analytics dataset in bouncePoller.ts — but every
// other provider pushes events here, so switching provider does not silently
// stop bounce tracking.
//
// Point the provider at:  {PUBLIC_URL}/api/webhooks/email/{provider}
//
//   ?s={WEBHOOK_SECRET}   (or the same as a bearer token)
//
// Off until WEBHOOK_SECRET is set (webhookAuth.ts): these mark people bounced
// or unsubscribed. Per-provider signature verification (Mailgun HMAC, Resend
// svix, SNS certificates) would be a further check; it isn't implemented.
// Mailgun and Mandrill check the address with a GET or HEAD when the webhook is
// added, which is answered without doing anything.

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
      // The address check some providers make when a webhook is added.
      GET: async () => Response.json({ ok: true }),
      HEAD: async () => new Response(null, { status: 200 }),
      POST: async ({ request, params }: { request: Request; params: { provider: string } }) => {
        try {
          const refused = webhookRefusal(webhookAuth(request), `${params.provider} webhook`)
          if (refused) return refused

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
            // Only ever AWS's own confirmation link, never one a sender made up.
            if (!isSnsUrl(subscribeUrl)) {
              return Response.json({ error: 'Not an Amazon SNS confirmation link' }, { status: 400 })
            }
            await fetch(subscribeUrl)
            console.log(`[WEBHOOK] Confirmed ${providerId} SNS subscription`)
            return Response.json({ success: true, confirmed: true })
          }

          const bounces = parseWebhook(body)
          for (const bounce of bounces) {
            console.log(
              `[WEBHOOK] ${providerId} ${bounce.type === 'complaint' ? 'spam complaint' : `${bounce.type} bounce`}` +
                (bounce.reason ? ` (${bounce.reason})` : ''),
            )
            if (bounce.type === 'complaint') {
              db.markComplained(bounce.email)
              continue
            }
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
