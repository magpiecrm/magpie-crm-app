import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'known-addresses-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
const { db } = await import('./db')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const contact = (email: string, first: string, last: string, prospect?: { email_status: any }) => {
  db.upsertContact(email, { builtin: { first_name: first, last_name: last } }, { create: true })
  if (prospect) db.setContactProspectFields(email, { source: 'socialfetch', ...prospect })
}

describe('knownAddressesAt', () => {
  it('counts real addresses, and unconfirmed guesses only once clicked or hard-bounced', () => {
    contact('bob.jones@acme.com', 'Bob', 'Jones')
    contact('ann.lee@acme.com', 'Ann', 'Lee', { email_status: 'verified' })
    contact('tom.hart@acme.com', 'Tom', 'Hart', { email_status: 'catch_all_likely' })
    contact('sue.ray@acme.com', 'Sue', 'Ray', { email_status: 'catch_all_likely' })
    contact('kim.day@acme.com', 'Kim', 'Day', { email_status: 'catch_all_likely' })
    contact('info@acme.com', '', '')
    contact('max.low@globex.com', 'Max', 'Low')
    const recipients = (db as any).data.campaign_recipients
    recipients.push(
      { campaign_id: 1, contact_email: 'tom.hart@acme.com', status: 'clicked', opened_at: 'x', clicked_at: 'x' },
      { campaign_id: 1, contact_email: 'sue.ray@acme.com', status: 'bounced_hard', opened_at: null, clicked_at: null },
      { campaign_id: 1, contact_email: 'kim.day@acme.com', status: 'sent', opened_at: null, clicked_at: null },
    )

    const kinds = Object.fromEntries(db.knownAddressesAt('ACME.com').map((a) => [a.email, a.kind]))
    expect(kinds).toEqual({
      'bob.jones@acme.com': 'known',
      'ann.lee@acme.com': 'known',
      'tom.hart@acme.com': 'engaged',
      'sue.ray@acme.com': 'bounced',
    })
    expect(db.knownAddressesAt('initech.com')).toEqual([])
  })
})
