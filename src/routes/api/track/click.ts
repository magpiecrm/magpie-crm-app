import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { decryptToken } from '../../../server/crypto'
import { looksAutomated } from '../../../server/clickFilter'

const NO_STORE = 'no-store, no-cache, must-revalidate, private'

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
            const { email, campaignId, url: targetUrl, trap } = decrypted
            const cid = typeof campaignId === 'number' ? campaignId : parseInt(campaignId, 10)
            const recipient = typeof email === 'string' ? email.toLowerCase().trim() : ''
            // The hidden trap link: no person can see it, so whatever followed it is automated (clickFilter.ts).
            if (trap) {
              if (recipient && !isNaN(cid)) db.recordTrap(recipient, cid)
              return new Response(null, { status: 204, headers: { 'Cache-Control': NO_STORE } })
            }
            if (recipient && !isNaN(cid)) {
              db.recordClick(recipient, cid, typeof targetUrl === 'string' ? targetUrl : undefined, {
                automated: looksAutomated(request.headers.get('user-agent')),
              })
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
            'Cache-Control': NO_STORE,
          },
        })
      },
    },
  },
})
