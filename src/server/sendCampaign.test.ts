import { beforeEach, describe, expect, it, vi } from 'vitest'

// A campaign that reaches nobody used to be marked 'sent' and reported as a
// success. These pin down the new behaviour, and — importantly — that the
// refusal path never touches contact records.

type Contact = { email: string; status: string; first_name?: string; last_name?: string; signed_up_at?: string; source?: string; email_status?: string }

const state: {
  contacts: Contact[]
  list_contacts: Array<{ list_id: number; contact_email: string }>
  runs: Array<{ sql: string; params: any[] }>
  html: string
  surveys: Array<{ id: string; name: string; status: string }>
  allowance: any
  suppression: Array<{ hash: string; kind: string; created_at: string }>
  unsubscribeEnabled: boolean | undefined
  status: string
  alreadySent: string[]
  released: number
  hold: any
  stops?: Record<string, { reason: string; at: string }>
  bounces?: Array<{ email: string; type: string; campaignId?: string }>
} = { contacts: [], list_contacts: [], runs: [], html: '<p>Hi</p>', surveys: [], allowance: null, suppression: [], unsubscribeEnabled: undefined, status: 'draft', alreadySent: [], released: 0, hold: null }

vi.mock('./db', () => ({
  db: {
    getAllowance: () => state.allowance,
    get data() {
      return { contacts: state.contacts, list_contacts: state.list_contacts, suppression: state.suppression, campaign_recipients: [] }
    },
    getContact: (email: string) => state.contacts.find((c) => c.email === email) ?? null,
    emailStop: (email: string) => state.stops?.[email] ?? null,
    updateRecipientBounceStatus: (email: string, type: string, campaignId?: string) => void (state.bounces ??= []).push({ email, type, campaignId }),
    getDisclosures: () => [],
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
            status: state.status, listId: 1, senderId: 1,
            senderName: 'Acme', senderEmail: 'hi@acme.com',
            unsubscribeEnabled: state.unsubscribeEnabled,
          }
        }
        return null
      },
    }),
    run: (sql: string, params: any[] = []) => { state.runs.push({ sql, params }) },
    prepare: () => ({ run: () => {} }),
    transaction: (fn: () => void) => fn,
    getSurvey: (id: string) => state.surveys.find((x) => x.id === id) ?? null,
    campaignScheduledAt: () => null,
    campaignRecipientEmails: () => new Set(state.alreadySent),
    getGuessHold: () => state.hold,
    setGuessHold: (_id: number, hold: any) => { state.hold = hold },
    restoreSent: () => { state.status = 'sent' },
    claimCampaignForSending: (_id: number, opts: { resume?: boolean; release?: boolean } = {}) => {
      if ((state.status === 'sent' && !opts.release) || (state.status === 'sending' && !opts.resume)) return false
      state.status = 'sending'
      return true
    },
    releaseCampaign: () => {
      state.released++
      state.status = 'draft'
    },
  },
}))

vi.mock('./nodemailer', () => ({ sendMail: vi.fn().mockResolvedValue({ messageId: 'x' }) }))
vi.mock('./notify', () => ({ notify: vi.fn() }))
vi.mock('./crypto', () => ({ encryptToken: () => 'tok' }))

const emailService = await import('./emailService')
const { hashesFor } = await import('./prospecting/suppression')

/** Puts this person on the opt-out list, as of `at`. */
function optOut(p: { email?: string; firstName?: string; lastName?: string; domain?: string }, at = '2026-09-01T00:00:00.000Z') {
  for (const h of hashesFor(p)) state.suppression.push({ ...h, created_at: at })
}

function listOf(...contacts: Contact[]) {
  state.contacts = contacts
  state.list_contacts = contacts.map((c) => ({ list_id: 1, contact_email: c.email }))
}

beforeEach(() => {
  state.contacts = []
  state.list_contacts = []
  state.runs = []
  state.html = '<p>Hi</p>'
  state.surveys = []
  state.allowance = null
  state.suppression = []
  state.unsubscribeEnabled = undefined
  state.status = 'draft'
  state.alreadySent = []
  state.released = 0
  state.hold = null
  delete process.env.SENDING_MANAGED
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

    expect(res).toEqual({ success: true, sentCount: 1, skippedOptOuts: 0, heldBack: 0 })
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

describe('sendCampaign and opt-outs', () => {
  it("skips people who opted out of being contacted, unless they've signed up since", async () => {
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockClear()
    listOf(
      { email: 'jane@acme.test', status: 'subscribed', first_name: 'Jane', last_name: 'Smith' },
      { email: 'bob@other.test', status: 'subscribed', first_name: 'Bob', last_name: 'Jones' },
      { email: 'sam@acme.test', status: 'subscribed', signed_up_at: '2026-09-10T00:00:00.000Z' },
      { email: 'ann@acme.test', status: 'subscribed', first_name: 'Ann', last_name: 'Lee' },
    )
    optOut({ email: 'jane@acme.test' })
    optOut({ email: 'sam@acme.test' }) // then signed up on a form
    optOut({ firstName: 'Ann', lastName: 'Lee', domain: 'acme.test' }) // by name at their company
    const res = await emailService.sendCampaign(1)
    expect(res).toMatchObject({ sentCount: 2, skippedOptOuts: 2 })
    expect(vi.mocked(sendMail).mock.calls.map((c) => c[0].to)).toEqual(['bob@other.test', 'sam@acme.test'])
  })

  it('refuses when everyone subscribed has opted out', async () => {
    listOf({ email: 'jane@acme.test', status: 'subscribed' })
    optOut({ email: 'jane@acme.test' })
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/opted out, unsubscribed or bounced before/)
  })
})

describe('sendCampaign and earlier unsubscribes and bounces', () => {
  it('skips an address that unsubscribed or hard-bounced before, even if its contact says subscribed', async () => {
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockClear()
    listOf(
      { email: 'back@acme.test', status: 'subscribed' },
      { email: 'again@acme.test', status: 'subscribed', signed_up_at: '2026-09-20T00:00:00.000Z' },
      { email: 'fine@acme.test', status: 'subscribed' },
    )
    // Re-imported after unsubscribing; the other signed up again since.
    state.stops = { 'back@acme.test': { reason: 'unsubscribed', at: '2026-09-01T00:00:00.000Z' }, 'again@acme.test': { reason: 'unsubscribed', at: '2026-09-01T00:00:00.000Z' } }
    const res = await emailService.sendCampaign(1)
    expect(res).toMatchObject({ sentCount: 2, skippedOptOuts: 1 })
    expect(vi.mocked(sendMail).mock.calls.map((c) => c[0].to)).toEqual(['again@acme.test', 'fine@acme.test'])
    state.stops = undefined
  })

  it('counts a "no such user" refusal at send time as a hard bounce, and anything else refused as a failed attempt', async () => {
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockReset()
    vi.mocked(sendMail)
      .mockRejectedValueOnce(Object.assign(new Error('Recipient address rejected'), { responseCode: 550, response: '550 5.1.1 <gone@acme.test>: User unknown' }))
      .mockRejectedValueOnce(Object.assign(new Error('Policy'), { responseCode: 550, response: '550 5.7.1 rejected by policy' }))
      .mockResolvedValue({ messageId: 'x' } as any)
    listOf({ email: 'gone@acme.test', status: 'subscribed' }, { email: 'blocked@acme.test', status: 'subscribed' }, { email: 'ok@acme.test', status: 'subscribed' })
    state.bounces = []
    await emailService.sendCampaign(1)
    expect(state.bounces).toEqual([{ email: 'gone@acme.test', type: 'hard', campaignId: '1' }])
    expect(state.runs.filter((r) => r.sql.includes("'bounced_soft'")).map((r) => r.params[1])).toEqual(['gone@acme.test', 'blocked@acme.test'])
    vi.mocked(sendMail).mockReset()
    vi.mocked(sendMail).mockResolvedValue({ messageId: 'x' } as any)
  })
})

describe('sendCampaign unsubscribe', () => {
  const sendOne = async (html: string) => {
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockClear()
    state.html = html
    state.status = 'draft' // each call is a fresh campaign
    listOf({ email: 'bob@other.test', status: 'subscribed' })
    await emailService.sendCampaign(1)
    return vi.mocked(sendMail).mock.calls[0][0]
  }

  it('adds a footer naming the sender unless the design links to it, and one-click headers', async () => {
    const msg = await sendOne('<html><body><p>Reply "unsubscribe" to stop</p></body></html>')
    expect(msg.html).toContain("Sent by Acme. Don't want these emails?")
    expect(msg.html).not.toContain('you subscribed')
    expect(msg.html.indexOf('Unsubscribe</a>')).toBeLessThan(msg.html.indexOf('</body>'))
    expect(msg.unsubscribeUrl).toBe('https://example.test/api/unsubscribe?t=tok')

    const own = await sendOne('<p>Hi</p><a href="{{unsubscribe}}">Leave</a>')
    expect(own.html).not.toContain('Sent by Acme')
    expect(own.html).toContain('href="https://example.test/api/unsubscribe?t=tok"')
  })

  it('can be switched off for self-hosted sending, but not when the host runs sending', async () => {
    state.unsubscribeEnabled = false
    const off = await sendOne('<p>Hi</p>')
    expect(off.html).not.toContain('Unsubscribe')
    expect(off.unsubscribeUrl).toBeUndefined()

    process.env.SENDING_MANAGED = 'on'
    const managed = await sendOne('<p>Hi</p>')
    expect(managed.html).toContain('Unsubscribe</a>')
    expect(managed.unsubscribeUrl).toBeDefined()
  })
})

describe('adding contacts by hand', () => {
  it('skips new people who opted out, and says how many', async () => {
    optOut({ email: 'jane@acme.test' })
    const res = await emailService.addContactsToList(1, [
      { email: 'Jane@Acme.test', attributes: { FIRSTNAME: 'Jane' } } as any,
      { email: 'bob@other.test', attributes: {} } as any,
    ])
    expect(res).toEqual({ added: 1, skipped: 1 })
    await expect(emailService.createContact({ email: 'jane@acme.test' })).rejects.toThrow(/opted out of being contacted/)
  })
})

describe('sendCampaign never sends twice', () => {
  it('refuses a campaign that has been sent or is being sent', async () => {
    listOf({ email: 'a@b.com', status: 'subscribed' })
    state.status = 'sent'
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/already been sent/)
    state.status = 'sending'
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/already being sent/)
    const { sendMail } = await import('./nodemailer')
    expect(sendMail).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.com', campaignId: 1 }))
  })

  it('skips everyone it already reached, and a resumed send finishes the rest', async () => {
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockClear()
    listOf({ email: 'a@b.com', status: 'subscribed' }, { email: 'c@d.com', status: 'subscribed' })
    state.alreadySent = ['a@b.com']
    state.status = 'sending'
    const res = await emailService.sendCampaign(1, { resume: true })
    expect(vi.mocked(sendMail).mock.calls.map((c) => c[0].to)).toEqual(['c@d.com'])
    expect(res.sentCount).toBe(1)
  })

  it('goes back to a draft when sending stops partway', async () => {
    const { sendMail } = await import('./nodemailer')
    const { AllowanceError } = await import('./allowance')
    listOf({ email: 'a@b.com', status: 'subscribed' })
    vi.mocked(sendMail).mockRejectedValueOnce(new AllowanceError('emailsSent', 'Out of emails.', null))
    await expect(emailService.sendCampaign(1)).rejects.toThrow(/Out of emails/)
    expect(state.released).toBe(1)
    expect(state.status).toBe('draft')
  })
})


describe('unverified prospected addresses', () => {
  const guesses = (n: number, status = 'catch_all_likely') =>
    Array.from({ length: n }, (_, i) => ({ email: `p${i}@acme.test`, status: 'subscribed', source: 'socialfetch', email_status: status }))
  const sentTo = async () => {
    const { sendMail } = await import('./nodemailer')
    return vi.mocked(sendMail).mock.calls.map((c) => c[0].to)
  }

  beforeEach(async () => {
    const { sendMail } = await import('./nodemailer')
    vi.mocked(sendMail).mockClear()
  })

  it('go out in a first batch of 50, the rest held back an hour', async () => {
    listOf(
      { email: 'own@b.com', status: 'subscribed' },
      { email: 'checked@acme.test', status: 'subscribed', source: 'socialfetch', email_status: 'verified' },
      ...guesses(60),
    )
    const before = Date.now()
    const res = await emailService.sendCampaign(1)
    const sent = await sentTo()
    expect(sent).toHaveLength(52)
    expect(sent).toContain('own@b.com')
    expect(sent).toContain('checked@acme.test')
    expect(sent).not.toContain('p50@acme.test')
    expect(res).toMatchObject({ sentCount: 52, heldBack: 10 })
    expect(state.hold).toMatchObject({ status: 'waiting', first_batch: 50, held: 10 })
    expect(Date.parse(state.hold.release_at) - before).toBeGreaterThanOrEqual(60 * 60_000)
  })

  it('all go out when there are no more than 50', async () => {
    listOf(...guesses(50, 'format_confirmed'))
    expect(await emailService.sendCampaign(1)).toMatchObject({ sentCount: 50, heldBack: 0 })
    expect(state.hold).toBeNull()
  })

  it('stay held when an interrupted send is resumed', async () => {
    listOf({ email: 'own@b.com', status: 'subscribed' }, ...guesses(60))
    state.hold = { status: 'waiting', first_batch: 50, held: 10, release_at: new Date().toISOString() }
    state.alreadySent = guesses(50).map((g) => g.email)
    state.status = 'sending'
    await emailService.sendCampaign(1, { resume: true })
    expect(await sentTo()).toEqual(['own@b.com'])
  })

  it('released: only the held-back ones go, and the campaign stays sent', async () => {
    listOf({ email: 'added-later@b.com', status: 'subscribed' }, ...guesses(60))
    state.status = 'sent'
    state.hold = { status: 'waiting', first_batch: 50, held: 10, release_at: new Date().toISOString() }
    state.alreadySent = guesses(50).map((g) => g.email)
    const res = await emailService.sendCampaign(1, { releaseGuesses: true })
    expect(await sentTo()).toEqual(guesses(60).slice(50).map((g) => g.email))
    expect(res.sentCount).toBe(10)
    expect(state.status).toBe('sending') // the mock's claim; the real db then writes 'sent'
    expect(state.runs.some((r) => r.sql.includes("status = 'sent'"))).toBe(true)
    expect(state.hold.status).toBe('released')
    await expect(emailService.sendCampaign(1, { releaseGuesses: true })).rejects.toThrow(/nobody held back/)
  })
})
