import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { decryptToken } from '../../../server/crypto'

export const Route = createFileRoute('/api/track/click')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url)
        const token = url.searchParams.get('t')
        
        let redirectUrl = '/'
        if (token) {
          const decrypted = decryptToken(token)
          if (decrypted) {
            const { email, campaignId, url: targetUrl } = decrypted
            if (email && campaignId) {
              const decodedEmail = email.toLowerCase().trim()
              const cid = typeof campaignId === 'number' ? campaignId : parseInt(campaignId, 10)
              if (!isNaN(cid)) db.recordClick(decodedEmail, cid, typeof targetUrl === 'string' ? targetUrl : undefined)
            }
            if (targetUrl) {
              redirectUrl = targetUrl
            }
          }
        }

        return new Response(null, {
          status: 302,
          headers: {
            'Location': redirectUrl,
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
          },
        })
      },
    },
  },
})
