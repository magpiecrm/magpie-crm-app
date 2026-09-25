import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { env } from '../../../server/env'

export const Route = createFileRoute('/api/webhooks/bounce')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        console.log('\n--- [WEBHOOK] BOUNCE EVENT RECEIVED ---')
        try {
          const authHeader = request.headers.get('Authorization')
          const secret = env.webhookSecret()

          // Require WEBHOOK_SECRET only if it's set in the environment
          if (secret && authHeader !== `Bearer ${secret}`) {
            console.warn('[WEBHOOK] Unauthorized access attempt')
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

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
