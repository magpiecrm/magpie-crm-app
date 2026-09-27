import { createFileRoute } from '@tanstack/react-router'

/**
 * Opt-outs, as keyed hashes, for a host that passes them between the copies
 * it runs (all with the same SUPPRESSION_SECRET), so someone who opts out of
 * one is left alone by all of them:
 *
 *   GET  /api/usage/suppressions?since=<ISO time>
 *        → { entries: [{ kind, hash, created_at }], until }
 *        This copy's own opt-outs after `since` (all of them without it);
 *        pass `until` as the next `since`.
 *   POST /api/usage/suppressions   { entries: [{ kind, hash }] }
 *        → { added, removed }
 *        Opt-outs from elsewhere: added to the list, and matching saved
 *        contacts deleted, as for an opt-out here.
 *
 *   Authorization: Bearer <USAGE_API_TOKEN>
 *
 * Off (404) unless USAGE_API_TOKEN is set. Hashes only, never who they are.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const KINDS = new Set(['email', 'profile', 'name_domain'])
const HASH = /^[a-f0-9]{64}$/
const MAX_ENTRIES = 5000

async function authorised(request: Request): Promise<Response | null> {
  const { env } = await import('../../server/env')
  if (!env.usageApiToken()) return json({ error: 'Not found' }, 404)
  const { hasUsageToken } = await import('../../server/usageToken')
  return hasUsageToken(request) ? null : json({ error: 'Unauthorized' }, 401)
}

export const Route = createFileRoute('/api/usage/suppressions')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const refused = await authorised(request)
        if (refused) return refused
        const since = new URL(request.url).searchParams.get('since')
        if (since && Number.isNaN(Date.parse(since))) return json({ error: 'since must be an ISO time' }, 400)
        const { db } = await import('../../server/db')
        const entries = db.suppressionsSince(since).map(({ kind, hash, created_at }) => ({ kind, hash, created_at }))
        const until = entries.reduce((latest, e) => (e.created_at > latest ? e.created_at : latest), since ?? '')
        return json({ entries, until: until || null })
      },
      POST: async ({ request }: { request: Request }) => {
        const refused = await authorised(request)
        if (refused) return refused
        let body: any
        try {
          body = await request.json()
        } catch {
          return json({ error: 'Invalid JSON body' }, 400)
        }
        const entries = Array.isArray(body?.entries) ? body.entries : null
        if (!entries || entries.length > MAX_ENTRIES) return json({ error: `entries must be a list of up to ${MAX_ENTRIES}` }, 400)
        if (!entries.every((e: any) => KINDS.has(e?.kind) && typeof e?.hash === 'string' && HASH.test(e.hash))) {
          return json({ error: 'Each entry needs a kind (email, profile or name_domain) and a 64-character hex hash' }, 400)
        }
        const { applySuppression } = await import('../../server/prospecting/suppression')
        const result = await applySuppression(
          entries.map((e: any) => ({ kind: e.kind, hash: e.hash })),
          'shared',
        )
        if (result.added) console.log(`[Suppression] ${result.added} opt-outs from the host (${result.removed} contacts removed)`)
        return json(result)
      },
    },
  },
})
