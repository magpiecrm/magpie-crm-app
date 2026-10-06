import { createFileRoute } from '@tanstack/react-router'

/**
 * Usage counts (see `src/server/usage.ts`), for whoever runs this copy of the
 * app: e.g. a hosting provider billing per prospect and reveal.
 *
 *   GET /api/usage                                every month with usage
 *   GET /api/usage?month=2026-09                  one month
 *   GET /api/usage?from=2026-09-22&to=2026-09-28  any days (UTC, both included);
 *       `countedSince` is the first day with daily counts, so a period
 *       starting earlier is only partly counted
 *   Authorization: Bearer <USAGE_API_TOKEN>
 *
 * Off (404) unless USAGE_API_TOKEN is set. Counts only; nothing about who.
 * Each month also carries `hitRate`: verified lookups out of those that
 * reached a mail server (`lookupHitRate` in usage.ts).
 * Each response also carries `storage`: the data file's size in bytes and
 * the row count of each collection, so a host can see a copy outgrowing it;
 * and `sending`: today's sending limits and each sending domain's standing
 * over the last week (sendingLimits.ts, sendingReputation.ts), counts only.
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

        const { getUsage, lookupHitRate, usageBetween, usageForMonth } = await import('../../server/usage')
        const { db } = await import('../../server/db')
        const storage = db.storageStats()
        const { dailyLimits } = await import('../../server/sendingLimits')
        const { domainReputations } = await import('../../server/sendingReputation')
        const sending = { limits: dailyLimits(), domains: domainReputations().map(({ domain, status, stats, reasons }) => ({ domain, status, stats, reasons: reasons.map((r) => r.text) })) }
        const params = new URL(request.url).searchParams
        const from = params.get('from')
        const to = params.get('to')
        if (from !== null || to !== null) {
          const day = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
          if (!from || !to || !day.test(from) || !day.test(to) || from > to) return json({ error: 'from and to must be days like 2026-09-22, from first' }, 400)
          const { counts, countedSince } = usageBetween(from, to)
          return json({ from, to, ...counts, hitRate: lookupHitRate(counts), countedSince, storage, sending })
        }
        const month = params.get('month')
        if (month !== null) {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: 'month must look like 2026-09' }, 400)
          const counts = usageForMonth(month)
          return json({ month, ...counts, hitRate: lookupHitRate(counts), storage, sending })
        }
        return json({ months: getUsage().map((m) => ({ ...m, hitRate: lookupHitRate(m) })), storage, sending })
      },
    },
  },
})
