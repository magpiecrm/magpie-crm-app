import { createFileRoute } from '@tanstack/react-router'

/**
 * This copy's sending domains and whether each is ready (see
 * `src/server/sendingDomains.ts`), for whoever hosts it:
 *
 *   GET /api/usage/domains
 *   Authorization: Bearer <USAGE_API_TOKEN>
 *
 * Off (404) unless USAGE_API_TOKEN is set. Domain names only.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export const Route = createFileRoute('/api/usage/domains')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await import('../../server/env')
        if (!env.usageApiToken()) return json({ error: 'Not found' }, 404)
        const { hasUsageToken } = await import('../../server/usageToken')
        if (!hasUsageToken(request)) return json({ error: 'Unauthorized' }, 401)
        const { getSendingDomains, isReady } = await import('../../server/sendingDomains')
        return json({ domains: getSendingDomains().map((d) => ({ domain: d.domain, ready: isReady(d) })) })
      },
    },
  },
})
