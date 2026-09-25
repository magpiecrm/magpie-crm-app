import { createServerFn } from '@tanstack/react-start'
import type { ProspectSearchParams } from '../prospectSearch'

// Generect (a.k.a. "Lusha") prospect search. All the fan-out, dedupe and
// cost-capping logic lives in `src/server/prospectSearch.ts` so the copilot's
// searchProspects tool gets exactly the same behaviour.
export const lushaSearchFn = createServerFn({ method: 'POST' })
  .inputValidator((d: ProspectSearchParams) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { runProspectSearch } = await import('../prospectSearch')
    await requireAuth()
    return runProspectSearch(data)
  })

// Reveals a single lead's email via Generect. This is a paid call, so it is
// only triggered explicitly by the user and every result (hits and misses
// alike) is cached by LinkedIn URL.
export const revealEmailFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { linkedinUrl: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const Generect = await import('../generect')
    const { db } = await import('../db')
    await requireAuth()

    const cached = db.getCachedEmailLookup(data.linkedinUrl)
    if (cached) return { email: cached.email, cached: true }

    const email = await Generect.findEmail(data.linkedinUrl)
    db.setCachedEmailLookup(data.linkedinUrl, email)
    return { email, cached: false }
  })

export const lushaUsageFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    const Generect = await import('../generect')
    await requireAuth()
    try {
      const usage = await Generect.getAccountUsage()
      return { generect: usage }
    } catch (err: any) {
      console.error('Generect usage fetch failed:', err.message)
      return { generect: null }
    }
  })
