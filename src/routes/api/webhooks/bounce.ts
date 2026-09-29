import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { webhookAuth, webhookRefusal } from '../../../server/webhookAuth'

export const Route = createFileRoute('/api/webhooks/bounce')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        console.log('\n--- [WEBHOOK] BOUNCE EVENT RECEIVED ---')
        try {
          // Bearer token only: the Cloudflare email worker sends it as a header.
          const refused = webhookRefusal(webhookAuth(request, { allowQuery: false }), 'bounce webhook')
          if (refused) return refused

          const body = await request.json()
          console.log('[WEBHOOK] Received body:', JSON.stringify(body))
          const { email, type, campaignId } = body

          if (!email) {
            console.warn('[WEBHOOK] Missing email in payload, returning 400')
            return Response.json({ error: 'Email is required' }, { status: 400 })
          }

          // Default to 'hard' bounce if type is missing
          const bounceType = type === 'soft' ? 'soft' : 'hard'
          console.log(`[WEBHOOK] Processing ${bounceType} bounce for ${email} (Campaign ID: ${campaignId || 'Unknown'})`)

          db.updateRecipientBounceStatus(email, bounceType, campaignId)

          return Response.json({ success: true })
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 500 })
        }
      },
    },
  },
})
