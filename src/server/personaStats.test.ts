import { describe, expect, it } from 'vitest'
import { personaStats } from './personaStats'

const contact = (name: string, persona_id?: string) => ({ email: `${name}@x.test`, persona_id })
const row = (campaign_id: number, name: string, fields: Record<string, unknown> = {}) => ({
  campaign_id,
  contact_email: `${name}@x.test`,
  status: 'sent',
  opened_at: null,
  clicked_at: null,
  sent_at: '2026-11-01T09:00:00Z',
  ...fields,
})

describe('personaStats', () => {
  it('counts what came of the people each persona found, among those an email could tell about', () => {
    const data = {
      contacts: [contact('ann', 'p1'), contact('bob', 'p1'), contact('cat', 'p1'), contact('dan', 'p1'), contact('eve', 'p2'), contact('fay')],
      campaigns: [
        { id: 1, sent_at: '2026-11-01T09:00:00Z' },
        { id: 2, sequence_id: 's1', sent_at: null },
      ],
      sequences: [{ id: 's1', sender_id: 1, settings: { track_opens: false, track_clicks: false } }],
      campaign_recipients: [
        row(1, 'ann', { opened_at: '2026-11-01T10:00:00Z' }),
        // Only a scanner loaded it: no open of theirs.
        row(1, 'bob', { bot_opens: 2 }),
        // Opens aren't tracked in this sequence, so dan stays out of the open rate.
        row(2, 'dan'),
        row(1, 'eve', { status: 'bounced_hard' }),
        row(1, 'fay', { opened_at: '2026-11-01T10:00:00Z' }),
      ],
      // A reply marked by hand is on the enrollment alone.
      sequence_enrollments: [{ sequence_id: 's1', contact_email: 'dan@x.test', replied_at: '2026-11-02T09:00:00Z' }],
      mailboxes: [],
    } as any

    expect(personaStats(data)).toEqual({
      p1: { saved: 4, emailed: 3, openTracked: 2, opened: 1, clickTracked: 2, clicked: 0, replied: 1 },
      p2: { saved: 1, emailed: 0, openTracked: 0, opened: 0, clickTracked: 0, clicked: 0, replied: 0 },
    })
  })

  it('has nothing to say with no contact found by a persona', () => {
    expect(personaStats({ contacts: [contact('ann')], campaigns: [], campaign_recipients: [] } as any)).toEqual({})
  })
})
