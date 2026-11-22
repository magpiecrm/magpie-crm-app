import { describe, expect, it } from 'vitest'
import { buildDemo } from './build'
import { buildDemoPlan } from './plan'
import { demoSendingDomain } from './sending'
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

describe('demo plan', () => {
  const now = new Date('2026-11-14T12:00:00Z')
  const { allowance, daily, monthly } = buildDemoPlan({ now, sentAt: demo.recipients.map((r) => r.sent_at) })

  it('is a month under way, part-used, with an Upgrade link', () => {
    expect(allowance.periodStart).toBe('2026-11-03T00:00:00.000Z')
    expect(allowance.periodEnd).toBe('2026-12-03T00:00:00.000Z')
    for (const kind of ['prospects', 'emailsSent', 'ai'] as const) {
      expect(allowance.used[kind]).toBeGreaterThan(0)
      expect(allowance.used[kind]).toBeLessThan(allowance.limits[kind]! * 0.7)
    }
    expect(allowance.upgradeUrl).toBe('https://magpiecrm.com/pricing')
  })

  it("counts the demo's own campaigns as emails sent, and nothing after now", () => {
    const sent = demo.recipients.filter((r) => r.sent_at && r.sent_at >= allowance.periodStart && r.sent_at <= now.toISOString()).length
    expect(allowance.used.emailsSent).toBe(sent)
    expect(Object.keys(daily).every((day) => day <= '2026-11-14')).toBe(true)
    expect(monthly['2026-11'].emailsSent).toBe(Object.entries(daily).filter(([d]) => d.startsWith('2026-11')).reduce((n, [, c]) => n + (c.emailsSent ?? 0), 0))
  })

  it('is counts only', () => {
    expect(JSON.stringify({ allowance, daily, monthly })).not.toMatch(/@/)
  })
})

describe('demo sending domain', () => {
  const domain = demoSendingDomain(new Date('2026-11-14T12:00:00Z'))

  it("is the workspace's own, verified, with the records a real one has", () => {
    expect(domain).toMatchObject({ domain: 'copperwick.example', ready: true })
    expect(domain.records.map((r) => r.name)).toEqual([expect.stringMatching(/^mg[0-9a-f]{8}\._domainkey\.copperwick\.example$/), '_dmarc.copperwick.example'])
    expect(domain.records[0].value).toMatch(/^v=DKIM1; k=rsa; p=MIIB[A-Za-z0-9+/]{300,}$/)
  })

  it('covers the demo sender, so Senders shows it ready', () => {
    expect(demo.sender.email.endsWith(`@${domain.domain}`)).toBe(true)
  })
})

describe("the week sending reputation looks at", () => {
  // sendingReputation.ts: 2% bounces or unsubscribes, or any complaint, puts a workspace at risk.
  const since = new Date(Date.parse('2026-11-14T12:00:00Z') - 7 * 86_400_000).toISOString()
  const week = demo.recipients.filter((r) => r.sent_at && r.sent_at >= since)
  const rate = (n: number) => n / week.length

  it('is healthy, so Settings → Sending shows a good reputation', () => {
    expect(week.length).toBeGreaterThanOrEqual(30)
    expect(rate(week.filter((r) => r.unsubscribed_at).length)).toBeLessThan(0.02)
    expect(rate(week.filter((r) => r.status === 'bounced_hard').length)).toBeLessThan(0.02)
    expect(week.filter((r) => r.complained_at)).toEqual([])
    expect(rate(week.filter((r) => r.opened_at).length)).toBeGreaterThanOrEqual(0.25)
  })
})
