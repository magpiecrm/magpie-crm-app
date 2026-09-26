import { createFileRoute } from '@tanstack/react-router'

/**
 * Monthly usage counts (see `src/server/usage.ts`), for whoever runs this copy
 * of the app: e.g. a hosting provider billing per prospect and reveal.
 *
 *   GET /api/usage                  every month with usage
 *   GET /api/usage?month=2026-09    one month
 *   Authorization: Bearer <USAGE_API_TOKEN>
 *
 * Off (404) unless USAGE_API_TOKEN is set. Counts only; nothing about who.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await import('../../server/env')
        if (!env.usageApiToken()) return json({ error: 'Not found' }, 404)
        const { hasUsageToken } = await import('../../server/usageToken')
        if (!hasUsageToken(request)) return json({ error: 'Unauthorized' }, 401)

        const { getUsage, usageForMonth } = await import('../../server/usage')
        const month = new URL(request.url).searchParams.get('month')
        if (month !== null) {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: 'month must look like 2026-09' }, 400)
          return json({ month, ...usageForMonth(month) })
        }
        return json({ months: getUsage() })
      },
    },
  },
})
