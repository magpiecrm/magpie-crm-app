import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * This billing period's allowances (see `src/server/allowance.ts`), set by
 * whoever hosts this copy and sells usage up front:
 *
 *   GET    /api/usage/allowance   the allowance and what's been used
 *   PUT    /api/usage/allowance   set it: { periodStart, periodEnd?, prospects?,
 *                                 reveals?, emailsSent?, upgradeUrl? }
 *   DELETE /api/usage/allowance   no limits
 *   Authorization: Bearer <USAGE_API_TOKEN>
 *
 * Off (404) unless USAGE_API_TOKEN is set. A missing or null amount has no limit.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const amount = z.number().int().min(0).nullable().optional()
const allowanceInput = z.object({
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }).nullable().optional(),
  prospects: amount,
  reveals: amount,
  emailsSent: amount,
  upgradeUrl: z.string().url().startsWith('https://').nullable().optional(),
})

async function guard(request: Request): Promise<Response | null> {
  const { env } = await import('../../server/env')
  if (!env.usageApiToken()) return json({ error: 'Not found' }, 404)
  const { hasUsageToken } = await import('../../server/usageToken')
  return hasUsageToken(request) ? null : json({ error: 'Unauthorized' }, 401)
}

export const Route = createFileRoute('/api/usage/allowance')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const refused = await guard(request)
        if (refused) return refused
        const { getAllowance } = await import('../../server/allowance')
        return json({ allowance: getAllowance() })
      },
      PUT: async ({ request }: { request: Request }) => {
        const refused = await guard(request)
        if (refused) return refused
        const parsed = allowanceInput.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400)
        const { setAllowance } = await import('../../server/allowance')
        return json({ allowance: setAllowance(parsed.data) })
      },
      DELETE: async ({ request }: { request: Request }) => {
        const refused = await guard(request)
        if (refused) return refused
        const { clearAllowance } = await import('../../server/allowance')
        clearAllowance()
        return json({ allowance: null })
      },
    },
  },
})
