import { beforeEach, describe, expect, it, vi } from 'vitest'

// A campaign that reaches nobody used to be marked 'sent' and reported as a
// success. These pin down the new behaviour, and — importantly — that the
// refusal path never touches contact records.

type Contact = { email: string; status: string; first_name?: string; last_name?: string }

const state: {
  contacts: Contact[]
  list_contacts: Array<{ list_id: number; contact_email: string }>
  runs: Array<{ sql: string; params: any[] }>
  html: string
  surveys: Array<{ id: string; name: string; status: string }>
  allowance: any
} = { contacts: [], list_contacts: [], runs: [], html: '<p>Hi</p>', surveys: [], allowance: null }

vi.mock('./db', () => ({
  db: {
    getAllowance: () => state.allowance,
    get data() {
      return { contacts: state.contacts, list_contacts: state.list_contacts }
    },
    // Only the subscribed-contacts SELECT matters here; everything else is
    // recorded so the tests can assert no writes happened.
    query: (sql: string) => ({
      all: (...params: any[]) => {
        if (sql.includes("c.status = 'subscribed'")) {
          const listId = params[0]
          const emails = new Set(
            state.list_contacts.filter((lc) => lc.list_id === listId).map((lc) => lc.contact_email),
          )
          return state.contacts.filter((c) => emails.has(c.email) && c.status === 'subscribed')
        }
        return [] // campaign_recipients stats
      },
      get: () => {
        if (sql.includes('FROM campaigns c')) {
          return {
            id: 1, name: 'Test', subject: 'Hi', htmlContent: state.html,
            status: 'draft', listId: 1, senderId: 1,
            senderName: 'Acme', senderEmail: 'hi@acme.com',
          }
        }
        return null
      },
    }),
    run: (sql: string, params: any[] = []) => { state.runs.push({ sql, params }) },
    prepare: () => ({ run: () => {} }),
    getSurvey: (id: string) => state.surveys.find((x) => x.id === id) ?? null,
  },
}))

vi.mock('./nodemailer', () => ({ sendMail: vi.fn().mockResolvedValue({ messageId: 'x' }) }))
vi.mock('./notify', () => ({ notify: vi.fn() }))
vi.mock('./crypto', () => ({ encryptToken: () => 'tok' }))

const emailService = await import('./emailService')

beforeEach(() => {
  state.contacts = []
  state.list_contacts = []
  state.runs = []
  state.html = '<p>Hi</p>'
  state.surveys = []
  state.allowance = null
  // Avoids the getRequest() fallback for the tracking base URL.
  process.env.PUBLIC_URL = 'https://example.test'
})

describe('sendCampaign with no reachable recipients', () => {
  it('refuses when every contact in the list is unsubscribed', async () => {
    state.contacts = [{ email: 'a@b.com', status: 'unsubscribed' }]
    state.list_contacts = [{ list_id: 1, contact_email: 'a@b.com' }]

    await expect(emailService.sendCampaign(1)).rejects.toThrow(/none of the 1 contact/i)
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/1 unsubscribed/)
  })

  it('refuses when the list is empty, with a different message', async () => {
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/list is empty/i)
  })

  it('does NOT mark the campaign sent when it reached nobody', async () => {
    state.contacts = [{ email: 'a@b.com', status: 'bounced' }]
    state.list_contacts = [{ list_id: 1, contact_email: 'a@b.com' }]

    await expect(emailService.sendCampaign(1)).rejects.toThrow()
    const sentWrites = state.runs.filter((r) => /UPDATE campaigns SET status = 'sent'/.test(r.sql))
    expect(sentWrites).toHaveLength(0)
  })

  it('does not modify contact records', async () => {
    state.contacts = [
      { email: 'a@b.com', status: 'unsubscribed' },
      { email: 'c@d.com', status: 'bounced' },
    ]
    state.list_contacts = [
      { list_id: 1, contact_email: 'a@b.com' },
      { list_id: 1, contact_email: 'c@d.com' },
    ]
    const before = JSON.stringify(state.contacts)

    await expect(emailService.sendCampaign(1)).rejects.toThrow()

    expect(JSON.stringify(state.contacts)).toBe(before)
    // No write of any kind should have been issued on the refusal path.
    expect(state.runs).toHaveLength(0)
  })

  it('reports a mixed breakdown so the cause is obvious', async () => {
    state.contacts = [
      { email: 'a@b.com', status: 'unsubscribed' },
      { email: 'c@d.com', status: 'bounced' },
    ]
    state.list_contacts = [
      { list_id: 1, contact_email: 'a@b.com' },
      { list_id: 1, contact_email: 'c@d.com' },
    ]
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/1 unsubscribed/)
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/1 bounced/)
  })
})

describe('sendCampaign with a plan allowance', () => {
  it('refuses a campaign bigger than the emails left, before sending any', async () => {
    const { sendMail } = await import('./nodemailer')
    ;(sendMail as any).mockClear()
    state.allowance = { periodStart: '2026-10-15T00:00:00Z', periodEnd: null, upgradeUrl: null, limits: { emailsSent: 1000 }, used: { ...{ prospects: 0, reveals: 0, emailsSent: 0 }, emailsSent: 999 } }
    state.contacts = [{ email: 'a@b.com', status: 'subscribed' }, { email: 'c@b.com', status: 'subscribed' }]
    state.list_contacts = [{ list_id: 1, contact_email: 'a@b.com' }, { list_id: 1, contact_email: 'c@b.com' }]
    await expect(emailService.sendCampaign(1)).rejects.toThrow('Sending this campaign needs 2 emails, but your plan has 1 left this month.')
    expect(sendMail).not.toHaveBeenCalled()
    expect(state.runs.some((r) => /status = 'sent'/.test(r.sql))).toBe(false)
  })
})

describe('sendCampaign happy path still works', () => {
  it('sends to subscribed contacts and marks the campaign sent', async () => {
    const { sendMail } = await import('./nodemailer')
    state.contacts = [
      { email: 'yes@b.com', status: 'subscribed', first_name: 'Yes' },
      { email: 'no@b.com', status: 'unsubscribed', first_name: 'No' },
    ]
    state.list_contacts = [
      { list_id: 1, contact_email: 'yes@b.com' },
      { list_id: 1, contact_email: 'no@b.com' },
    ]

    const res = await emailService.sendCampaign(1)

    expect(res).toEqual({ success: true, sentCount: 1 })
    // The unsubscribed contact must be skipped, not merely un-emailed.
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect((sendMail as any).mock.calls[0][0].to).toBe('yes@b.com')
    expect(state.runs.some((r) => /UPDATE campaigns SET status = 'sent'/.test(r.sql))).toBe(true)
    // Contact rows are still untouched on the success path.
    expect(state.contacts.map((c) => c.status)).toEqual(['subscribed', 'unsubscribed'])
  })
})

describe('sendCampaign with a survey block', () => {
  const surveyHtml = '<a href="{{ survey_link:s1 }}">Take it</a><a href="https://site.test/x">Other</a>'

  beforeEach(() => {
    state.contacts = [{ email: 'a@b.com', status: 'subscribed' }]
    state.list_contacts = [{ list_id: 1, contact_email: 'a@b.com' }]
    state.html = surveyHtml
  })

  it('refuses to send when the survey is not published', async () => {
    state.surveys = [{ id: 's1', name: 'NPS', status: 'draft' }]
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/isn't published/)
    state.surveys = []
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/no longer exists/)
  })

  it('gives each recipient a direct survey link that skips click tracking', async () => {
    state.surveys = [{ id: 's1', name: 'NPS', status: 'published' }]
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockClear()
    await emailService.sendCampaign(1)
    const html = vi.mocked(sendMail).mock.calls[0][0].html as string
    expect(html).toContain('href="https://example.test/s/s1?t=tok"')
    expect(html).toContain('/api/track/click?t=') // the other link is still tracked
    expect(html).not.toContain('survey_link')
  })
})
