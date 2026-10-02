import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Reply detection: telling replies from auto-replies, bounces and the
// sender's own mail; and reading a (fake) inbox end to end on a scratch
// database, with the sequence engine holding follow-ups until it has.

const scratchDir = mkdtempSync(join(tmpdir(), 'mailboxes-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://app.example.test'

const sent: Array<{ to: string; subject: string; messageId?: string }> = []
vi.mock('../nodemailer', () => ({
  sendMail: vi.fn(async (msg: { to: string; subject: string; messageId?: string }) => {
    sent.push(msg)
    return { messageId: 'x' }
  }),
}))
const notices: string[] = []
vi.mock('../notify', () => ({ notify: (type: string, message: string) => notices.push(`${type}: ${message}`) }))

const { db } = await import('../db')
const { sequences } = await import('../sequences')
const { runSequences } = await import('../sequences/engine')
const { mailboxes, pollMailboxes } = await import('.')
const { classifyInbound, isStopRequest, leadingText, parseBounce, buildIndex, matchReply } = await import('./classify')
const { parseHeaderBlock, idsIn } = await import('./imap')
const { encryptToken } = await import('../crypto')
const { env } = await import('../env')
type Msg = import('./imap').InboundMessage

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const msg = (over: Partial<Msg> = {}): Msg => ({
  uid: 1,
  messageId: '<in@x>',
  inReplyTo: null,
  references: [],
  from: 'ava@larkspur.test',
  subject: 'Re: Quick question',
  date: new Date().toISOString(),
  headers: {},
  ...over,
})

describe('classifying a message', () => {
  const own = ['jo@acme.test']
  it('tells replies from auto-replies, bounces and our own mail', () => {
    expect(classifyInbound(msg(), own)).toBe('reply')
    expect(classifyInbound(msg({ from: 'JO@acme.test' }), own)).toBe('own')
    expect(classifyInbound(msg({ headers: { 'auto-submitted': 'auto-replied' } }), own)).toBe('auto_reply')
    expect(classifyInbound(msg({ headers: { 'auto-submitted': 'no' } }), own)).toBe('reply')
    expect(classifyInbound(msg({ subject: 'Automatic reply: Quick question' }), own)).toBe('auto_reply')
    expect(classifyInbound(msg({ subject: 'Out of Office: back Monday' }), own)).toBe('auto_reply')
    expect(classifyInbound(msg({ headers: { 'x-autoreply': 'yes' } }), own)).toBe('auto_reply')
    expect(classifyInbound(msg({ from: 'MAILER-DAEMON@mx.google.com', subject: 'Delivery Status Notification (Failure)' }), own)).toBe('bounce')
    expect(classifyInbound(msg({ from: 'postmaster@larkspur.test', headers: { 'content-type': 'multipart/report; report-type=delivery-status; boundary="x"' } }), own)).toBe('bounce')
  })

  it('reads header blocks and message ids', () => {
    expect(parseHeaderBlock('References: <a@x>\r\n <b@x>\r\nAuto-Submitted: auto-replied\r\n\r\n')).toEqual({ references: '<a@x> <b@x>', 'auto-submitted': 'auto-replied' })
    expect(idsIn('<a@x> <b@x>')).toEqual(['<a@x>', '<b@x>'])
  })

  it('matches a reply by the thread, else by who it is from (only after we emailed them)', () => {
    const index = buildIndex([{ item: 'ava', email: 'ava@larkspur.test', messageIds: ['<one@acme.test>'], firstSentAt: '2026-10-01T10:00:00.000Z' }])
    expect(matchReply(msg({ from: 'ava.personal@gmail.test', references: ['<ONE@acme.test>'] }), index)).toEqual({ item: 'ava', by: 'thread' })
    expect(matchReply(msg({ date: '2026-10-02T09:00:00.000Z' }), index)).toEqual({ item: 'ava', by: 'from' })
    expect(matchReply(msg({ date: '2026-09-30T09:00:00.000Z' }), index)).toBeNull()
    expect(matchReply(msg({ from: 'colleague@larkspur.test' }), index)).toBeNull()
  })

  it('reads bounce reports and "stop" replies', () => {
    const dsn = 'Content-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; mx.example\r\nFinal-Recipient: rfc822; ava@larkspur.test\r\nAction: failed\r\nStatus: 5.1.1\r\n'
    expect(parseBounce(dsn)).toEqual({ recipient: 'ava@larkspur.test', hard: true })
    expect(parseBounce(dsn.replace('5.1.1', '4.2.2'))).toEqual({ recipient: 'ava@larkspur.test', hard: false })
    expect(isStopRequest('Stop.\n\n> On Tue, Jo wrote:')).toBe(true)
    expect(isStopRequest('please remove me')).toBe(true)
    expect(isStopRequest("Don't stop, this is interesting")).toBe(false)
    const qp = 'Content-Type: multipart/alternative; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nUnsubscribe me=2E\r\n--b--'
    expect(isStopRequest(leadingText(qp))).toBe(true)
  })
})

/** A fake inbox: its messages, and how many times it's been read. */
function fakeInbox(messages: Msg[], opts: { fail?: Error; sources?: Record<number, string> } = {}) {
  const calls = { connects: 0, fetches: [] as unknown[] }
  const connect = async () => {
    calls.connects++
    if (opts.fail) throw opts.fail
    return {
      open: async () => ({ path: '[Gmail]/All Mail', uidValidity: '7', uidNext: Math.max(1, ...messages.map((m) => m.uid)) + 1 }),
      fetch: async (from: { afterUid: number } | { since: Date }) => {
        calls.fetches.push(from)
        return messages.filter((m) => ('afterUid' in from ? m.uid > from.afterUid : true))
      },
      source: async (uid: number) => opts.sources?.[uid] ?? 'Content-Type: text/plain\r\n\r\nThanks, tell me more.',
      close: async () => {},
    }
  }
  return { connect, calls }
}

function contact(email: string) {
  db.mutate((d) => {
    d.contacts = d.contacts.filter((c) => c.email !== email)
    d.contacts.push({ email, first_name: email.split('@')[0], last_name: 'Stone', job_title: '', company: 'Larkspur', status: 'subscribed', created_at: new Date().toISOString() } as any)
  })
}

const always = { days: [0, 1, 2, 3, 4, 5, 6], start_hour: 0, end_hour: 24, time_zone: 'Europe/London' }

function sequenceFor(emails: string[]) {
  const s = sequences.create({ name: 'Intro', senderId: 1 }, null)
  sequences.update(s.id, {
    steps: [
      { delay_days: 0, subject: 'Quick question', body: 'Hi {{ contact.first_name }}' },
      { delay_days: 1, subject: null, body: 'Following up' },
    ],
    settings: { ...always, signature: 'Jo' },
  })
  sequences.setStatus(s.id, 'active')
  sequences.enroll(s.id, emails, {}, null)
  return s.id
}

function connectInbox(over: Partial<import('../db').MailboxRecord> = {}) {
  db.mutate((d) => {
    d.mailboxes = [
      {
        id: 'mb1', sender_id: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test',
        secret: encryptToken({ password: 'app-pass' }, env.credentialsSecret()),
        status: 'ok', last_error: null, error_since: null, last_polled_at: null, folder: null, uid_validity: null, last_uid: null,
        replies_found: 0, created_at: '', updated_at: '', ...over,
      },
    ]
  })
}

const enrollment = (email: string) => db.data.sequence_enrollments!.find((e) => e.contact_email === email)!

beforeEach(() => {
  sent.length = 0
  notices.length = 0
  db.mutate((d) => {
    d.sequences = []
    d.sequence_enrollments = []
    d.mailboxes = []
    d.email_stops = {}
    if (!d.senders.some((s) => s.id === 1)) d.senders.push({ id: 1, name: 'Jo', email: 'jo@acme.test' })
  })
})

describe('reading an inbox', () => {
  it("stops someone's sequence when they reply, and lets you know", async () => {
    contact('ava@larkspur.test')
    contact('ben@larkspur.test')
    sequenceFor(['ava@larkspur.test', 'ben@larkspur.test'])
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    await runSequences(new Date(t0 + 21 * 60_000), () => 0)
    expect(sent.map((m) => m.to).sort()).toEqual(['ava@larkspur.test', 'ben@larkspur.test'])
    connectInbox()
    const avaFirst = enrollment('ava@larkspur.test').sends[0].message_id
    const inbox = fakeInbox([
      msg({ uid: 10, from: 'jo@acme.test', subject: 'Quick question' }), // our own, in All Mail
      msg({ uid: 11, from: 'ben@larkspur.test', subject: 'Automatic reply: Quick question', headers: { 'auto-submitted': 'auto-replied' } }),
      msg({ uid: 12, from: 'ava.home@gmail.test', inReplyTo: avaFirst, references: [avaFirst], date: new Date(t0 + 5 * 60_000).toISOString() }),
    ])
    await pollMailboxes(new Date(t0 + 10 * 60_000), inbox.connect)
    expect(enrollment('ava@larkspur.test')).toMatchObject({ status: 'replied', reply: { matched_by: 'thread' } })
    expect(enrollment('ben@larkspur.test').status).toBe('active')
    expect(notices).toEqual(['sequence_reply: ava Stone replied to "Intro"'])
    expect(db.data.mailboxes![0]).toMatchObject({ status: 'ok', last_uid: 12, uid_validity: '7', replies_found: 1 })

    // The next read carries on after the last message.
    await pollMailboxes(new Date(t0 + 13 * 60_000), inbox.connect)
    expect(inbox.calls.fetches.at(-1)).toEqual({ afterUid: 12 })
    expect(notices).toHaveLength(1)

    // Ben's follow-up goes (the inbox was just read); Ava's never does.
    await runSequences(new Date(t0 + 25 * 60 * 60_000), () => 0)
    expect(sent.filter((m) => m.to === 'ava@larkspur.test')).toHaveLength(1)
  })

  it('unsubscribes someone who replies "stop", and records bounce reports', async () => {
    contact('ava@larkspur.test')
    contact('ben@larkspur.test')
    sequenceFor(['ava@larkspur.test', 'ben@larkspur.test'])
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    await runSequences(new Date(t0 + 21 * 60_000), () => 0)
    connectInbox()
    const inbox = fakeInbox(
      [msg({ uid: 1, from: 'ava@larkspur.test', date: new Date(t0 + 60 * 60_000).toISOString() }), msg({ uid: 2, from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)' })],
      { sources: { 1: 'Content-Type: text/plain\r\n\r\nSTOP', 2: 'Final-Recipient: rfc822; ben@larkspur.test\r\nStatus: 5.1.1\r\n' } },
    )
    await pollMailboxes(new Date(t0 + 2 * 60 * 60_000), inbox.connect)
    expect(enrollment('ava@larkspur.test').status).toBe('replied')
    expect(db.getContact('ava@larkspur.test')?.status).toBe('unsubscribed')
    expect(db.emailStop('ava@larkspur.test')?.reason).toBe('unsubscribed')
    expect(notices[0]).toMatch(/asking not to be emailed again, so they're unsubscribed/)
    expect(enrollment('ben@larkspur.test').status).toBe('bounced')
  })

  it('holds follow-ups until the inbox has been read, and pauses the sequence when the login is refused', async () => {
    contact('ava@larkspur.test')
    const id = sequenceFor(['ava@larkspur.test'])
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    connectInbox({ last_polled_at: new Date(t0).toISOString() })
    // A day later the inbox hasn't been read since: the follow-up waits.
    await runSequences(new Date(t0 + 25 * 60 * 60_000), () => 0)
    expect(sent).toHaveLength(1)

    const refused = Object.assign(new Error('Invalid credentials (Failure)'), { authenticationFailed: true })
    await pollMailboxes(new Date(t0 + 25 * 60 * 60_000), fakeInbox([], { fail: refused }).connect)
    expect(db.data.mailboxes![0]).toMatchObject({ status: 'auth_failed' })
    expect(db.data.mailboxes![0].last_error).toMatch(/app password/)
    expect(notices.at(-1)).toMatch(/Reply detection for jo@acme.test stopped/)
    await runSequences(new Date(t0 + 26 * 60 * 60_000), () => 0)
    expect(sequences.get(id).sequence).toMatchObject({ status: 'paused', auto_paused: 'reply_detection' })

    // Disconnecting the inbox lets it carry on (replies marked by hand).
    mailboxes.remove('mb1')
    await runSequences(new Date(t0 + 27 * 60 * 60_000), () => 0)
    expect(sequences.get(id).sequence.status).toBe('active')
    expect(sent).toHaveLength(2)
  })

  it("won't connect an inbox whose login fails, and keeps the saved password when changing other details", async () => {
    const bad = fakeInbox([], { fail: Object.assign(new Error('Invalid credentials'), { authenticationFailed: true }) })
    await expect(mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', password: 'wrong' }, bad.connect)).rejects.toThrow(/app password/)
    const good = fakeInbox([])
    const saved = await mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', password: 'right' }, good.connect)
    expect(saved).toMatchObject({ status: 'ok', folder: '[Gmail]/All Mail' })
    expect(saved).not.toHaveProperty('secret')
    await mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test' }, good.connect)
    expect(good.calls.connects).toBe(2)
    await expect(mailboxes.save({ senderId: 1, host: 'outlook.office365.com', port: 993, secure: true, user: 'jo@acme.test', password: 'x' }, good.connect)).rejects.toThrow(/Microsoft 365/)
  })
})
