import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { decryptToken } from '../../../server/crypto'

export const Route = createFileRoute('/api/track/open')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url)
        const token = url.searchParams.get('t')

        if (token) {
          const decrypted = decryptToken(token)
          if (decrypted) {
            const { email, campaignId } = decrypted
            if (email && campaignId) {
              const decodedEmail = email.toLowerCase().trim()
              const cid = typeof campaignId === 'number' ? campaignId : parseInt(campaignId, 10)
              if (!isNaN(cid)) db.recordOpen(decodedEmail, cid)
            }
          }
        }

        // 1x1 transparent GIF representation
        const gifBase64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
        const gifBuffer = Uint8Array.from(atob(gifBase64), c => c.charCodeAt(0))

        return new Response(gifBuffer, {
          headers: {
            'Content-Type': 'image/gif',
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
          },
        })
      },
    },
  },
})
