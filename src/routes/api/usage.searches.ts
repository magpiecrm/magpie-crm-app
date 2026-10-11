import { createFileRoute } from '@tanstack/react-router'

/**
 * The search log (see `src/server/prospecting/searchLog.ts`), for whoever
 * runs this copy of the app: what each people search was for and what came
 * of it, so a host can see which job titles, countries or industries find
 * few people or few emails.
 *
 *   GET /api/usage/searches?since=2026-10-01   searches finished on or after that day (UTC)
 *       → { searches: [{ id, at, ms, filters, counts, lookups }] }
 *       Without `since`, the last 30 days. The log keeps the newest 1,000
 *       searches for 90 days.
 *   Authorization: Bearer <USAGE_API_TOKEN>
 *
 * Off (404) unless USAGE_API_TOKEN is set. Filters and counts only: never
 * who a search found.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export const Route = createFileRoute('/api/usage/searches')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await import('../../server/env')
        if (!env.usageApiToken()) return json({ error: 'Not found' }, 404)
        const { hasUsageToken } = await import('../../server/usageToken')
        if (!hasUsageToken(request)) return json({ error: 'Unauthorized' }, 401)

        const since = new URL(request.url).searchParams.get('since')
        if (since !== null && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(since)) return json({ error: 'since must be a day like 2026-10-01' }, 400)
        const { db } = await import('../../server/db')
        const from = since ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
        return json({ since: from, searches: db.searchLogSince(from) })
      },
    },
  },
})
