import crypto from 'crypto'
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

function tokenMatches(given: string, expected: string): boolean {
  // Compare digests so the check takes the same time whatever the length.
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await import('../../server/env')
        const expected = env.usageApiToken()
        if (!expected) return json({ error: 'Not found' }, 404)

        const auth = request.headers.get('authorization') ?? ''
        const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
        if (!given || !tokenMatches(given, expected)) return json({ error: 'Unauthorized' }, 401)

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
