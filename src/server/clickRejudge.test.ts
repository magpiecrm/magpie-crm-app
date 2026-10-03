import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Counts recorded before a click rule was added are corrected when the app starts.

const scratchDir = mkdtempSync(join(tmpdir(), 'click-rejudge-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
const sent = '2026-10-01T12:45:00.000Z'
const at = (s: number) => new Date(Date.parse(sent) + s * 1000).toISOString()
// A scanner that followed the trap link, then re-checked the pricing link for hours: counted as 4 clicks by a person.
writeFileSync(
  process.env.DATABASE_PATH,
  JSON.stringify({
    lists: [], contacts: [], list_contacts: [], senders: [],
    campaigns: [{ id: 12, name: 'Pricing', subject: 's', preview_text: null, html_content: '', list_id: null, sender_id: null, status: 'sent', unsubscribe_enabled: true, created_at: sent, sent_at: sent }],
    campaign_recipients: [
      {
        campaign_id: 12, contact_email: 'ops@bigco.test', status: 'clicked', opened_at: null, clicked_at: at(4300), sent_at: sent, trapped_at: at(590),
        clicks: 4, bot_clicks: 1, links: { 'https://magpiecrm.com/pricing': 4 },
        click_events: [590, 4300, 4500, 9000, 21000].map((s) => ({ url: 'https://magpiecrm.com/pricing', at: at(s) })),
        clicks_before: { clicks: 0, links: {}, at: null, bots: 0 },
      },
    ],
  }),
)

const { db } = await import('./db')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('click counts on start', () => {
  it("re-judges clicks from a mailbox whose trap link was followed, so a scanner's re-checks stop counting as a person", () => {
    expect(db.data.campaign_recipients[0]).toMatchObject({ clicks: 0, bot_clicks: 5, clicked_at: null, status: 'sent', links: {} })
  })
})
