import { describe, expect, it } from 'vitest'
import { buildDemo } from './build'
import { fromProspectSearch, isUnconfirmedGuess } from '../prospecting/types'

// The demo workspace (seed.ts): made up, on .example, and nothing in it can send.

const demo = buildDemo({ now: new Date('2026-11-14T12:00:00Z'), senderId: 1, owner: 'demo@copperwick.example' })
const emails = new Set(demo.contacts.map((c) => c.email))

describe('demo workspace', () => {
  it('uses only .example addresses and sites', () => {
    const json = JSON.stringify(demo)
    const addresses = [...json.matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]+)/gi)].map((m) => m[1])
    const sites = [...json.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => h !== 'www.w3.org' && h !== 'schemas.microsoft.com')
    expect([...addresses, ...sites].filter((h) => !h.endsWith('.example'))).toEqual([])
  })

  it('has no one from prospect search', () => {
    expect(demo.contacts.filter((c) => c.source || fromProspectSearch(c.source) || isUnconfirmedGuess(c) || c.search_hash)).toEqual([])
  })

  it('has nothing waiting to send', () => {
    expect(demo.campaigns.filter((c) => !['sent', 'draft', 'sequence'].includes(c.status) || c.scheduled_at)).toEqual([])
    expect(demo.sequences.every((s) => s.status === 'paused' && !s.auto_paused)).toBe(true)
    expect(demo.enrollments.filter((e) => e.status === 'active' || e.next_send_at || e.claim || e.drafts)).toEqual([])
    expect(demo.forms.some((f) => f.welcome_email_enabled)).toBe(false)
    expect(demo.activities.filter((a) => a.kind === 'task' && !a.done_at && a.due_at && a.due_at <= '2026-11-14T12:00:00Z' && !a.reminded_at)).toEqual([])
  })

  it('points only at what it made', () => {
    const recipients = demo.recipients.filter((r) => !emails.has(r.contact_email) || !demo.campaigns.some((c) => c.id === r.campaign_id))
    const members = demo.listContacts.filter((m) => !emails.has(m.contact_email) || !demo.lists.some((l) => l.id === m.list_id))
    const deals = demo.deals.filter((d) => !d.contact_emails.every((e) => emails.has(e)) || !demo.companies.some((c) => c.id === d.company_id))
    const enrollments = demo.enrollments.filter((e) => !emails.has(e.contact_email) || e.sends.some((s) => !demo.campaigns.some((c) => c.id === s.campaign_id)))
    expect({ recipients, members, deals, enrollments }).toEqual({ recipients: [], members: [], deals: [], enrollments: [] })
    expect(demo.contacts.every((c) => demo.companies.some((co) => co.id === c.company_id))).toBe(true)
  })

  it('makes the same people every time', () => {
    const again = buildDemo({ now: new Date('2026-12-01T09:00:00Z'), senderId: 3, owner: null })
    expect(again.contacts.map((c) => c.email).sort()).toEqual([...emails].sort())
  })
})
