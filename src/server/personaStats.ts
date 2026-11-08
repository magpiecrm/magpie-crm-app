// How the people found with each persona took the email they were sent, for
// the Personas page. Counts only: who they are stays on the server.

import type { DbSchema } from './db'
import { engagementByEmail } from './engagement'

export interface PersonaStats {
  /** Contacts saved from a search with the persona applied (and still here). */
  saved: number
  /** Of those, sent at least one email that didn't bounce. */
  emailed: number
  /** Of those emailed, sent one that tracked opens, and of those, opened one. */
  openTracked: number
  opened: number
  clickTracked: number
  clicked: number
  /** Of those emailed, replied: seen by a connected inbox or marked by hand. */
  replied: number
}

const blank = (): PersonaStats => ({ saved: 0, emailed: 0, openTracked: 0, opened: 0, clickTracked: 0, clicked: 0, replied: 0 })

/**
 * By persona id. Opens and clicks are people's own (engagement.ts reads the
 * times judged not to be scanners'), and only count among those whose emails
 * tracked them, so a sequence with tracking off doesn't drag a rate down.
 */
export function personaStats(data: DbSchema): Record<string, PersonaStats> {
  const personaOf = new Map(data.contacts.filter((c) => c.persona_id).map((c) => [c.email, c.persona_id!]))
  const stats: Record<string, PersonaStats> = {}
  if (!personaOf.size) return stats

  const campaigns = new Map(data.campaigns.map((c) => [c.id, c]))
  const emailed = new Set<string>()
  for (const r of data.campaign_recipients) {
    if (!personaOf.has(r.contact_email) || r.status.startsWith('bounced')) continue
    if (r.sent_at ?? campaigns.get(r.campaign_id)?.sent_at) emailed.add(r.contact_email)
  }

  const engagement = engagementByEmail(data)
  for (const [email, personaId] of personaOf) {
    const s = (stats[personaId] ??= blank())
    s.saved++
    if (!emailed.has(email)) continue
    s.emailed++
    const e = engagement.get(email)
    if (e?.opened.eligible) {
      s.openTracked++
      if (e.opened.last) s.opened++
    }
    if (e?.clicked.eligible) {
      s.clickTracked++
      if (e.clicked.last) s.clicked++
    }
    if (e?.replied.last) s.replied++
  }
  return stats
}
