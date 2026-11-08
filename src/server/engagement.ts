// Each person's opens, clicks and replies across campaigns and sequences: for
// building lists from filters (listBuilder.ts) and personas' numbers
// (personaStats.ts).

import type { DbSchema } from './db'
import type { Activity } from '../features/contacts/contactFilters'

type Engagement = Record<'opened' | 'clicked' | 'replied', Activity>

const later = (a: string | null, b: string | null | undefined) => (b && (!a || b > a) ? b : a)

/**
 * Each person's opens, clicks and replies, and the latest email each could have
 * happened on. Reads only the times already judged to be people's (db.ts
 * judgeOpens, judgeClicks), so scanners stay out. Sequence emails are rows here
 * too, under a hidden campaign, with their own settings for what's tracked.
 */
export function engagementByEmail(data: DbSchema): Map<string, Engagement> {
  const campaigns = new Map(data.campaigns.map((c) => [c.id, c]))
  const sequences = new Map((data.sequences ?? []).map((s) => [s.id, s]))
  const watched = new Set((data.mailboxes ?? []).filter((m) => m.status === 'ok').map((m) => m.sender_id))
  const people = new Map<string, Engagement>()
  const of = (email: string) => {
    const known = people.get(email)
    if (known) return known
    const blank = (): Activity => ({ last: null, eligible: null })
    const fresh = { opened: blank(), clicked: blank(), replied: blank() }
    people.set(email, fresh)
    return fresh
  }

  for (const r of data.campaign_recipients) {
    const person = of(r.contact_email)
    const campaign = campaigns.get(r.campaign_id)
    const sequence = campaign?.sequence_id ? sequences.get(campaign.sequence_id) : undefined
    person.opened.last = later(later(person.opened.last, r.last_opened_at ?? r.opened_at), r.clicked_at)
    person.clicked.last = later(person.clicked.last, r.clicked_at)
    person.replied.last = later(person.replied.last, r.replied_at)

    const sent = r.status.startsWith('bounced') ? null : (r.sent_at ?? campaign?.sent_at)
    const tracksOpens = sequence ? sequence.settings.track_opens : campaign?.track_opens !== false
    const tracksClicks = sequence ? sequence.settings.track_clicks : true
    if (tracksOpens) person.opened.eligible = later(person.opened.eligible, sent)
    if (tracksClicks) person.clicked.eligible = later(person.clicked.eligible, sent)
    if (sequence?.sender_id != null && watched.has(sequence.sender_id)) person.replied.eligible = later(person.replied.eligible, sent)
  }
  // A reply marked by hand is on the enrollment alone.
  for (const e of data.sequence_enrollments ?? []) of(e.contact_email).replied.last = later(of(e.contact_email).replied.last, e.replied_at)
  return people
}
