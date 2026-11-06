import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  managed: false,
  data: {} as any,
  dns: { spf: true, dmarc: true },
  listed: [] as string[],
  provider: { providerId: 'smtp', creds: { host: 'smtp.acme.test' } } as any,
}

vi.mock('../db', () => ({ db: { get data() { return state.data } } }))
vi.mock('../env', () => ({ env: { sendingManaged: () => state.managed } }))
vi.mock('../emailService', () => ({ withoutBuilderData: (html: string) => html.replace(/<!-- BLOCKS_DATA: [\s\S]*? -->/g, '') }))
vi.mock('../sendingDomains', () => ({ canSendFrom: () => true }))
vi.mock('../sendingReputation', () => ({
  domainReputations: () => [],
  kindResolver: () => (email: string) => (state.data.contacts.find((c: any) => c.email === email)?.source ? 'cold' : 'optIn'),
}))
vi.mock('../sendingLimits', () => ({ dailyLimits: () => null }))
vi.mock('../emailSettings', () => ({ getActiveProviderConfig: () => state.provider }))
vi.mock('../inboxWarmup', () => ({ warmupOffered: () => false, warmupStanding: async () => ({}) }))
vi.mock('../dnsAuth', () => ({
  authRecords: async () => state.dns,
  dblListed: async () => ({ checked: true, listed: state.listed }),
}))

const { campaignSpamScore, sequenceSpamScore, combine } = await import('./index')

const settings = { track_opens: false, track_clicks: false, days: [1], start_hour: 9, end_hour: 17, time_zone: 'Europe/London', daily_cap: 50, signature: 'Jo', footer: 'Not interested? {{ unsubscribe }}' }

beforeEach(() => {
  state.managed = false
  state.dns = { spf: true, dmarc: true }
  state.listed = []
  state.provider = { providerId: 'smtp', creds: { host: 'smtp.acme.test' } }
  state.data = {
    senders: [{ id: 1, name: 'Jo', email: 'jo@acme.test' }, { id: 2, name: 'Jo', email: 'jo@gmail.com' }],
    contacts: [
      { email: 'a@x.test', status: 'subscribed', source: 'search', email_status: 'verified' },
      { email: 'b@x.test', status: 'subscribed', source: 'search', email_status: 'catch_all_likely' },
      { email: 'c@x.test', status: 'unsubscribed' },
    ],
    list_contacts: [{ list_id: 7, contact_email: 'a@x.test' }, { list_id: 7, contact_email: 'b@x.test' }, { list_id: 7, contact_email: 'c@x.test' }],
    sequences: [
      {
        id: 's1',
        sender_id: 1,
        steps: [
          { id: 'a', delay_days: 0, subject: 'Quick question', body: 'Hi {{ contact.first_name }}, worth a chat?' },
          { id: 'b', delay_days: 3, subject: null, body: 'Hi {{ contact.first_name }}, ACT NOW for a risk-free trial: https://bit.ly/x https://a.test https://b.test https://c.test' },
        ],
        settings,
      },
    ],
    sequence_enrollments: [{ sequence_id: 's1', contact_email: 'a@x.test', status: 'active' }],
  }
})

const draft = { subject: 'Quick question', previewText: 'A note', htmlContent: '<p>Hi {{ contact.first_name }}, worth a chat?</p>', senderId: 1, listId: 7, trackOpens: false, unsubscribeEnabled: true }

describe('combine', () => {
  it('adds points up to 100, and a finding that makes it high does so whatever the points', () => {
    const f = (points: number, hard = false) => ({ code: String(points), part: 'content' as const, points, fixable: true, text: '', fix: '', ...(hard ? { hard } : {}) })
    expect(combine([f(20), f(10)])).toMatchObject({ score: 30, level: 'medium' })
    expect(combine([f(80), f(80)]).score).toBe(100)
    expect(combine([f(5), f(0, true)])).toMatchObject({ score: 60, level: 'high' })
    expect(combine([f(5), f(0, true), f(10)]).findings.map((x) => x.code)).toEqual(['0', '10', '5'])
  })
})

describe('a campaign', () => {
  it('counts only subscribed people, and treats a mostly prospected list as cold', async () => {
    const s = await campaignSpamScore(draft)
    // Both subscribed contacts were found by prospecting; one is an unverified address at a catch-all company.
    expect(s.findings.map((x) => x.code)).toEqual(expect.arrayContaining(['mostly_cold', 'many_unconfirmed', 'many_catch_all', 'new_sender']))
    // Plain content, but who it goes to makes it medium.
    expect(s.findings.some((x) => x.part === 'content')).toBe(false)
    expect(s.level).toBe('medium')
  })

  it("doesn't mark down the unsubscribe switch where the host's mail server adds the link anyway", async () => {
    expect((await campaignSpamScore({ ...draft, unsubscribeEnabled: false })).findings.map((x) => x.code)).toContain('no_unsubscribe')
    state.managed = true
    expect((await campaignSpamScore({ ...draft, unsubscribeEnabled: false })).findings.map((x) => x.code)).not.toContain('no_unsubscribe')
  })

  it('ignores the builder data hidden in the HTML', async () => {
    const s = await campaignSpamScore({ ...draft, htmlContent: `${draft.htmlContent}<!-- BLOCKS_DATA: {"text":"ACT NOW risk-free"} -->` })
    expect(s.findings.map((x) => x.code)).not.toContain('body_phrases')
  })

  it("is high for a free mailbox sent through another server, but not through its own", async () => {
    expect((await campaignSpamScore({ ...draft, senderId: 2 })).level).toBe('high')
    state.provider = { providerId: 'smtp', creds: { host: 'smtp.gmail.com' } }
    expect((await campaignSpamScore({ ...draft, senderId: 2 })).findings.map((x) => x.code)).not.toContain('free_mail')
  })

  it('has no sender findings until a sender is chosen', async () => {
    state.dns = { spf: false, dmarc: false }
    expect((await campaignSpamScore({ ...draft, senderId: null })).findings.some((x) => x.part === 'sender')).toBe(false)
  })
})

describe('a sequence', () => {
  it('scores each email, and the sequence by its worst', async () => {
    const s = await sequenceSpamScore('s1')
    expect(s.steps?.map((st) => st.step)).toEqual([1, 2])
    expect(s.steps![1].score).toBeGreaterThan(s.steps![0].score)
    expect(s.score).toBe(s.steps![1].score)
    // The worst email's own findings carry its number; the sender's apply to all.
    expect(s.findings.filter((x) => x.part === 'content').every((x) => x.step === 2)).toBe(true)
    expect(s.findings.map((x) => x.code)).toEqual(expect.arrayContaining(['shortener', 'many_links_cold', 'new_sender']))
  })

  it('scores an unsaved draft of its emails and settings', async () => {
    const s = await sequenceSpamScore('s1', { steps: [{ subject: 'Hello', body: 'Hi {{ contact.first_name }}, see https://a.test' }], settings: { track_clicks: true } })
    expect(s.steps).toHaveLength(1)
    expect(s.findings.map((x) => x.code)).toEqual(expect.arrayContaining(['masked_link', 'click_tracking_cold']))
  })

  it("counts who it still has to email", async () => {
    const s = await sequenceSpamScore('s1')
    // Only a@x.test is in progress: one cold, verified person.
    expect(s.findings.map((x) => x.code)).not.toContain('many_catch_all')
  })
})
