import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { createServer, type AddressInfo } from 'net'
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
const { runSequences, recoverClaims } = await import('../sequences/engine')
const { mailboxes, pollMailboxes, checkEarlierInboxes } = await import('.')
const { sendMail } = await import('../nodemailer')
const { classifyInbound, isStopRequest, leadingText, parseBounce, buildIndex, matchReply } = await import('./classify')
const { parseHeaderBlock, idsIn, zohoHosts, imapConnect, describeError, readStructure } = await import('./imap')

/** Connecting checks the mailbox can send (send.ts checkSending); here it's said to, without sending anything. */
const checked: Array<{ host: string; port: number; user: string }> = []
const sendsFine = async (_sender: unknown, smtp: { host: string; port: number; user: string }) => (checked.push(smtp), { ok: true as const, sentAutosave: true })
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
    // Inbox warmup's mail, even from someone the sequence has emailed, isn't a reply.
    expect(classifyInbound(msg({ headers: { 'x-mailtrace-verify': 'tok_1' } }), own)).toBe('warmup')
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

/** A fake inbox: its messages, how many times it's been read, and what was put in its Sent folder. */
function fakeInbox(messages: Msg[], opts: { fail?: Error; sources?: Record<number, string>; texts?: Record<number, string>; attachments?: Record<number, number>; noSent?: boolean } = {}) {
  const calls = { connects: 0, fetches: [] as unknown[], appended: [] as string[] }
  const connect = async () => {
    calls.connects++
    if (opts.fail) throw opts.fail
    return {
      open: async () => ({ path: '[Gmail]/All Mail', uidValidity: '7', uidNext: Math.max(1, ...messages.map((m) => m.uid)) + 1 }),
      fetch: async (from: { afterUid: number } | { since: Date; sender?: string }) => {
        calls.fetches.push(from)
        return messages.filter((m) => ('afterUid' in from ? m.uid > from.afterUid : !from.sender || m.from === from.sender))
      },
      source: async (uid: number) => opts.sources?.[uid] ?? 'Content-Type: text/plain\r\n\r\nThanks, tell me more.',
      text: async (uid: number, maxChars: number) => {
        const text = opts.texts?.[uid] ?? leadingText(opts.sources?.[uid] ?? 'Content-Type: text/plain\r\n\r\nThanks, tell me more.')
        return { text: text.slice(0, maxChars), truncated: text.length > maxChars, attachments: opts.attachments?.[uid] ?? 0 }
      },
      appendSent: async (raw: Buffer) => {
        if (opts.noSent) return false
        calls.appended.push(raw.toString('utf8'))
        return true
      },
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

  it('says an inbox is failing only once it has been for a while, and once each time', async () => {
    contact('ava@larkspur.test')
    sequenceFor(['ava@larkspur.test'])
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    connectInbox({ host: 'imappro.zoho.eu' })
    notices.length = 0
    const hungUp = fakeInbox([], { fail: Object.assign(new Error('Unexpected close'), { code: 'ClosedAfterConnectTLS', reason: 'IMAP4rev1 Server logging out' }) })
    const poll = (min: number, inbox = hungUp) => pollMailboxes(new Date(t0 + min * 60_000), inbox.connect)

    // Zoho hangs up on one login and the next one works: nobody's told.
    await poll(1)
    expect(db.data.mailboxes![0]).toMatchObject({ status: 'error', last_error: 'imappro.zoho.eu closed the connection while logging in (IMAP4rev1 Server logging out).' })
    await poll(4, fakeInbox([]))
    expect(db.data.mailboxes![0].status).toBe('ok')
    expect(notices).toEqual([])

    // Failing for a quarter of an hour: told, once.
    for (const min of [7, 10, 13, 16, 22, 25]) await poll(min)
    expect(notices).toEqual(["sequence_paused: Reply detection for jo@acme.test isn't working: imappro.zoho.eu closed the connection while logging in (IMAP4rev1 Server logging out)."])
    expect(mailboxes.list()[0]).not.toHaveProperty('error_notified')

    // Working again, then failing again for as long: told again.
    await poll(28, fakeInbox([]))
    for (const min of [31, 47]) await poll(min)
    expect(notices).toHaveLength(2)
  })

  it("connects a Zoho inbox at the server for its region and kind of account, whichever the form named", async () => {
    // Zoho's servers: only the EU business one knows this login.
    const tried: string[] = []
    const zoho = (async (login: { host: string }) => {
      tried.push(login.host)
      if (login.host !== 'imappro.zoho.eu') throw Object.assign(new Error('Invalid credentials'), { authenticationFailed: true })
      return { open: async () => ({ path: 'INBOX', uidValidity: '1', uidNext: 1 }), fetch: async () => [], source: async () => '', text: async () => ({ text: '', truncated: false, attachments: 0 }), appendSent: async () => false, close: async () => {} }
    }) as any
    const eu = async () => ['mx.zoho.eu', 'mx2.zoho.eu']
    const saved = await mailboxes.save({ senderId: 1, host: 'imap.zoho.com', port: 993, secure: true, user: 'jo@acme.test', password: 'right' }, zoho, eu, sendsFine)
    expect(saved).toMatchObject({ status: 'ok', host: 'imappro.zoho.eu' })
    // It sends through the Zoho server that goes with the one that worked.
    expect(checked.at(-1)).toMatchObject({ host: 'smtppro.zoho.eu', port: 587, user: 'jo@acme.test' })
    // Where the address's own mail goes says the region: the US servers aren't tried at all.
    expect(tried).toEqual(['imappro.zoho.eu'])

    expect(zohoHosts(['mx.zoho.eu'])).toEqual(['imappro.zoho.eu', 'imap.zoho.eu'])
    expect(zohoHosts(['mx.zohocloud.ca.'])).toEqual(['imappro.zohocloud.ca', 'imap.zohocloud.ca'])
    // Mail delivered somewhere else, or nowhere we could find: the two commonest regions.
    expect(zohoHosts(['aspmx.l.google.com'])).toEqual(['imappro.zoho.com', 'imap.zoho.com', 'imappro.zoho.eu', 'imap.zoho.eu'])
    // A server typed in by hand comes first.
    expect(zohoHosts(['mx.zoho.eu'], 'imap.zoho.in')).toEqual(['imap.zoho.in', 'imappro.zoho.eu', 'imap.zoho.eu'])

    // Refused everywhere: says what Zoho needs, having tried each once.
    tried.length = 0
    await expect(mailboxes.save({ senderId: 1, host: 'imap.zoho.com', port: 993, secure: true, user: 'jo@acme.test', password: 'wrong' }, (async (login: { host: string }) => {
      tried.push(login.host)
      throw Object.assign(new Error('Invalid credentials'), { authenticationFailed: true })
    }) as any, eu)).rejects.toThrow(/IMAP access is switched on.*application-specific password/)
    expect(tried).toEqual(['imappro.zoho.eu', 'imap.zoho.eu'])
    // A server that can't be reached isn't a reason to try the others.
    tried.length = 0
    await expect(mailboxes.save({ senderId: 1, host: 'imap.zoho.com', port: 993, secure: true, user: 'jo@acme.test', password: 'x' }, (async (login: { host: string }) => {
      tried.push(login.host)
      throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    }) as any, eu)).rejects.toThrow(/Couldn't reach imappro.zoho.eu/)
    expect(tried).toEqual(['imappro.zoho.eu'])
  })

  it("won't connect an inbox whose login fails, and keeps the saved password when changing other details", async () => {
    const bad = fakeInbox([], { fail: Object.assign(new Error('Invalid credentials'), { authenticationFailed: true }) })
    await expect(mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', password: 'wrong' }, bad.connect)).rejects.toThrow(/app password/)
    const good = fakeInbox([])
    const saved = await mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', password: 'right' }, good.connect, undefined, sendsFine)
    expect(saved).toMatchObject({ status: 'ok', folder: '[Gmail]/All Mail' })
    expect(saved).not.toHaveProperty('secret')
    await mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test' }, good.connect, undefined, sendsFine)
    expect(good.calls.connects).toBe(2)
    await expect(mailboxes.save({ senderId: 1, host: 'outlook.office365.com', port: 993, secure: true, user: 'jo@acme.test', password: 'x' }, good.connect)).rejects.toThrow(/Microsoft 365/)
  })
})

describe('connecting over IMAP', () => {
  it('survives a server that hangs up during the login, as Zoho sometimes does', async () => {
    // A server that greets, answers CAPABILITY, then says goodbye to the login and closes.
    const server = createServer((socket) => {
      socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready\r\n')
      socket.on('data', (chunk) => {
        for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
          const [tag, command] = line.split(' ')
          if (/^capability$/i.test(command)) socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK done\r\n`)
          else if (/^(authenticate|login)$/i.test(command)) socket.end('* BYE IMAP4rev1 Server logging out\r\n')
          else socket.write(`${tag} OK done\r\n`)
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const err = await imapConnect({ host: '127.0.0.1', port, secure: false, user: 'jo@acme.test', password: 'app-pass' }).then(
        () => null,
        (e: unknown) => e,
      )
      expect(err).toBeTruthy()
      // The login's own failure comes after connect's; it mustn't escape (it used to crash the app).
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(describeError(err, '127.0.0.1')).toBe('127.0.0.1 closed the connection while logging in (IMAP4rev1 Server logging out).')
    } finally {
      server.close()
    }
  })
})

describe('keeping the conversation', () => {
  it("keeps what they wrote, and carries on after they've replied", async () => {
    contact('ava@larkspur.test')
    contact('ben@larkspur.test')
    sequenceFor(['ava@larkspur.test', 'ben@larkspur.test'])
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    await runSequences(new Date(t0 + 21 * 60_000), () => 0)
    connectInbox()
    const avaFirst = enrollment('ava@larkspur.test').sends[0].message_id
    const at = (min: number) => new Date(t0 + min * 60_000).toISOString()
    const first = fakeInbox(
      [
        msg({ uid: 1, messageId: '<r1@larkspur.test>', inReplyTo: avaFirst, references: [avaFirst], date: at(30) }),
        msg({ uid: 2, from: 'ben@larkspur.test', subject: 'Automatic reply: Quick question', headers: { 'auto-submitted': 'auto-replied' } }),
      ],
      { texts: { 1: 'Sounds good, Thursday?\n\nOn Tue, Jo wrote:\n> Hi Ava' }, attachments: { 1: 2 } },
    )
    await pollMailboxes(new Date(t0 + 40 * 60_000), first.connect)
    expect(enrollment('ava@larkspur.test')).toMatchObject({ status: 'replied' })
    expect(enrollment('ava@larkspur.test').messages).toEqual([
      expect.objectContaining({ direction: 'in', message_id: '<r1@larkspur.test>', from: 'ava@larkspur.test', text: 'Sounds good, Thursday?\n\nOn Tue, Jo wrote:\n> Hi Ava', attachments: 2, seen: false, at: at(30) }),
    ])
    // An out-of-office isn't kept.
    expect(enrollment('ben@larkspur.test').messages).toBeUndefined()

    // Jo answers from Gmail (in the thread); later Ava writes again, and asks to stop. A message to Ava outside the thread isn't kept.
    const next = fakeInbox(
      [
        msg({ uid: 3, from: 'jo@acme.test', messageId: '<a1@acme.test>', inReplyTo: '<r1@larkspur.test>', references: [avaFirst, '<r1@larkspur.test>'], date: at(50) }),
        msg({ uid: 4, from: 'jo@acme.test', messageId: '<other@acme.test>', subject: 'Lunch?', date: at(55) }),
        msg({ uid: 5, messageId: '<r2@larkspur.test>', inReplyTo: '<a1@acme.test>', references: ['<a1@acme.test>'], date: at(70) }),
        // A new email from her, not in the thread: not the sequence's business.
        msg({ uid: 6, messageId: '<news@larkspur.test>', subject: 'Our newsletter', date: at(75) }),
      ],
      { texts: { 3: 'Thursday it is.', 4: 'Lunch?', 5: 'Please remove me.\n\nOn Tue, Jo wrote:\n> Thursday it is.', 6: 'News' } },
    )
    db.mutate((d) => void (d.mailboxes![0].last_uid = 2))
    await pollMailboxes(new Date(t0 + 80 * 60_000), next.connect)
    const messages = enrollment('ava@larkspur.test').messages!
    expect(messages.map((m) => [m.direction, m.via ?? null, m.message_id])).toEqual([
      ['in', null, '<r1@larkspur.test>'],
      ['out', 'inbox', '<a1@acme.test>'],
      ['in', null, '<r2@larkspur.test>'],
    ])
    // Not stopped again or counted as a new reply, but you're told, and "remove me" unsubscribes them.
    expect(db.data.mailboxes![0].replies_found).toBe(1)
    expect(notices.at(-1)).toBe('sequence_reply: ava Stone wrote again about "Intro" asking not to be emailed again, so they\'re unsubscribed')
    expect(db.getContact('ava@larkspur.test')?.status).toBe('unsubscribed')

    // Reading the same messages again (the folder was rebuilt) keeps nothing twice.
    db.mutate((d) => void (d.mailboxes![0].uid_validity = 'rebuilt'))
    await pollMailboxes(new Date(t0 + 90 * 60_000), next.connect)
    expect(enrollment('ava@larkspur.test').messages).toHaveLength(3)
  })

  it('cuts a long message, and keeps one whose text couldn\'t be read', async () => {
    contact('ava@larkspur.test')
    sequenceFor(['ava@larkspur.test'])
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    connectInbox()
    const inbox = fakeInbox([msg({ uid: 1, date: new Date(t0 + 60_000).toISOString() })], { texts: { 1: 'y'.repeat(25_000) } })
    await pollMailboxes(new Date(t0 + 5 * 60_000), inbox.connect)
    expect(enrollment('ava@larkspur.test').messages![0]).toMatchObject({ truncated: true })
    expect(enrollment('ava@larkspur.test').messages![0].text).toHaveLength(20_000)

    // A reader that fails on the text still keeps the message, with none.
    const broken = async () => ({ ...(await inbox.connect()), text: async () => Promise.reject(new Error('BODYSTRUCTURE failed')) })
    db.mutate((d) => void (d.mailboxes![0].last_uid = 1))
    const later = fakeInbox([msg({ uid: 2, messageId: '<later@x>', references: [enrollment('ava@larkspur.test').messages![0].message_id!], date: new Date(t0 + 10 * 60_000).toISOString() })])
    await pollMailboxes(new Date(t0 + 15 * 60_000), async () => ({ ...(await later.connect()), text: (await broken()).text }))
    expect(enrollment('ava@larkspur.test').messages!.at(-1)).toMatchObject({ message_id: '<later@x>', text: '' })
    expect(db.data.mailboxes![0].status).toBe('ok')
  })
})

describe('replies from before their words were kept', () => {
  it('looks each one up once, by who it is from, and keeps what is in the thread', async () => {
    contact('ava@larkspur.test')
    contact('ben@larkspur.test')
    contact('cy@larkspur.test')
    sequenceFor(['ava@larkspur.test', 'ben@larkspur.test', 'cy@larkspur.test'])
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    await runSequences(new Date(t0 + 21 * 60_000), () => 0)
    await runSequences(new Date(t0 + 42 * 60_000), () => 0)
    const at = (min: number) => new Date(t0 + min * 60_000).toISOString()
    // Ava's reply was found by an older version, which kept only that she replied; Ben's was marked by hand; Cy's isn't in the inbox.
    db.mutate(() => {
      enrollment('ava@larkspur.test').reply = { at: at(60), matched_by: 'thread' }
      enrollment('ben@larkspur.test').reply = { at: at(60), matched_by: 'manual' }
      enrollment('cy@larkspur.test').reply = { at: at(60), matched_by: 'from' }
      for (const e of db.data.sequence_enrollments!) e.status = 'replied'
    })
    connectInbox({ folder: '[Gmail]/All Mail', uid_validity: '7', last_uid: 9, last_polled_at: at(70) })
    const avaFirst = enrollment('ava@larkspur.test').sends[0].message_id
    const inbox = fakeInbox(
      [
        msg({ uid: 3, messageId: '<r1@larkspur.test>', inReplyTo: avaFirst, references: [avaFirst], date: at(60) }),
        // Another email from her, outside the thread: not part of it.
        msg({ uid: 4, messageId: '<news@larkspur.test>', subject: 'Our newsletter', date: at(65) }),
        msg({ uid: 5, from: 'ben@larkspur.test', messageId: '<b1@larkspur.test>', subject: 'Re: Quick question', date: at(61) }),
      ],
      { texts: { 3: 'Yes please, Thursday?', 4: 'News', 5: 'Call me' } },
    )
    await pollMailboxes(new Date(t0 + 80 * 60_000), inbox.connect)
    expect(enrollment('ava@larkspur.test').messages).toEqual([expect.objectContaining({ direction: 'in', message_id: '<r1@larkspur.test>', text: 'Yes please, Thursday?', seen: true })])
    expect(enrollment('ben@larkspur.test').messages).toEqual([expect.objectContaining({ message_id: '<b1@larkspur.test>', text: 'Call me' })])
    expect(enrollment('cy@larkspur.test').messages).toBeUndefined()
    for (const e of db.data.sequence_enrollments!) expect(e.reply_searched_at).toBe(new Date(t0 + 80 * 60_000).toISOString())
    // Old news: nobody is told, and they aren't counted as new replies.
    expect(notices).toEqual([])
    expect(db.data.mailboxes![0].replies_found).toBe(0)

    // Looked up once: the next read doesn't search for them again.
    const searches = inbox.calls.fetches.filter((f) => 'sender' in (f as object)).length
    expect(searches).toBe(3)
    await pollMailboxes(new Date(t0 + 85 * 60_000), inbox.connect)
    expect(inbox.calls.fetches.filter((f) => 'sender' in (f as object))).toHaveLength(3)
  })
})

describe("reading a message's structure", () => {
  it('finds the text and HTML parts and counts real attachments', () => {
    expect(readStructure({ type: 'text/plain' })).toEqual({ plain: '1', html: null, attachments: 0 })
    expect(
      readStructure({
        type: 'multipart/mixed',
        childNodes: [
          { type: 'multipart/related', childNodes: [{ type: 'multipart/alternative', childNodes: [{ part: '1.1.1', type: 'text/plain' }, { part: '1.1.2', type: 'text/html' }] }, { part: '1.2', type: 'image/png', id: '<logo>' }] },
          { part: '2', type: 'application/pdf', disposition: 'attachment' },
          { part: '3', type: 'text/plain', disposition: 'attachment' },
          { part: '4', type: 'message/rfc822', childNodes: [{ part: '4.1', type: 'text/plain' }] },
        ],
      }),
    ).toEqual({ plain: '1.1.1', html: '1.1.2', attachments: 3 })
    expect(readStructure({ type: 'multipart/alternative', childNodes: [{ part: '1', type: 'text/html' }] })).toEqual({ plain: null, html: '1', attachments: 0 })
  })
})

describe("sending through the sender's own mailbox", () => {
  type Sent = { to: string; subject: string; text?: string; html?: string; via?: { mailboxId: string }; unsubscribeMailto?: string; campaignId?: number; unsubscribeUrl?: string; messageId?: string }
  const last = () => sent.at(-1) as Sent
  const iso = (ms: number) => new Date(ms).toISOString()

  /** The connected inbox, its sending checked out (or as given). */
  function canSend(over: Partial<import('../db').MailboxSending> = {}, inbox: Partial<import('../db').MailboxRecord> = {}) {
    connectInbox({
      last_polled_at: iso(Date.now()),
      ...inbox,
      sending: {
        host: 'smtp.gmail.com', port: 587, verified_at: iso(Date.now() - 86_400_000), verified_for: 'jo@acme.test', sent_autosave: true,
        daily_cap: 40, status: 'ok', last_error: null, error_since: null, ...over,
      },
    })
  }
  const sendingOf = () => db.data.mailboxes![0].sending!
  // Each test's emails are its own: an earlier test's recipient row for the same step would stand in for one.
  beforeEach(() =>
    db.mutate((d) => {
      d.campaigns = []
      d.campaign_recipients = []
    }),
  )

  it('sends through it once it has checked out, with "reply stop" in place of a link, and no tracking', async () => {
    contact('ava@larkspur.test')
    const id = sequenceFor(['ava@larkspur.test'])
    sequences.update(id, { settings: { track_opens: true, track_clicks: true } })
    canSend()
    await runSequences(new Date(), () => 0)
    expect(last()).toMatchObject({ to: 'ava@larkspur.test', via: { mailboxId: 'mb1' }, unsubscribeMailto: 'mailto:jo@acme.test?subject=unsubscribe' })
    expect(last()).not.toHaveProperty('campaignId')
    expect(last()).not.toHaveProperty('unsubscribeUrl')
    expect(last().text).toMatch(/Not interested\? Just reply "stop" and I won't email you again\./)
    for (const part of [last().text, last().html]) expect(part).not.toMatch(/https?:|<img|<a /)
    const e = enrollment('ava@larkspur.test')
    expect(e.sends[0]).toMatchObject({ via: 'mailbox' })
    expect(db.data.campaign_recipients.find((r) => r.contact_email === 'ava@larkspur.test')).toMatchObject({ status: 'sent', via: 'mailbox' })
    // The next waits a few minutes, whichever sequence it's in.
    expect(Date.parse(sendingOf().next_at!)).toBeGreaterThan(Date.now() + 60_000)
  })

  it('goes through the mail server as chosen, or until the mailbox has checked out', async () => {
    contact('ava@larkspur.test')
    contact('ben@larkspur.test')
    sequenceFor(['ava@larkspur.test', 'ben@larkspur.test'])
    const t0 = Date.now()
    canSend({ use_server: true })
    await runSequences(new Date(t0), () => 0)
    expect(last()).not.toHaveProperty('via')
    expect(last()).toMatchObject({ campaignId: expect.any(Number), unsubscribeUrl: expect.stringContaining('/api/unsubscribe?t=') })
    expect(last().text).toMatch(/Unsubscribe here \(https:\/\/app\.example\.test\/api\/unsubscribe/)
    canSend({ verified_at: null, verified_for: null, last_error: "couldn't log in" })
    await runSequences(new Date(t0 + 21 * 60_000), () => 0)
    expect(sent).toHaveLength(2)
    expect(last()).not.toHaveProperty('via')
  })

  it("needs no ready sending domain on a hosted copy: that's for the mail server", async () => {
    process.env.SENDING_MANAGED = 'on'
    try {
      contact('ava@larkspur.test')
      const id = sequenceFor(['ava@larkspur.test'])
      canSend()
      await runSequences(new Date(), () => 0)
      expect(last()).toMatchObject({ via: { mailboxId: 'mb1' } })
      // Through the mail server, the same sender would need its domain set up first.
      contact('ben@larkspur.test')
      sequences.enroll(id, ['ben@larkspur.test'], {}, null)
      db.mutate(() => (sendingOf().use_server = true))
      await runSequences(new Date(Date.now() + 21 * 60_000), () => 0)
      expect(sent).toHaveLength(1)
      expect(sequences.get(id).sequence).toMatchObject({ status: 'paused', auto_paused: 'sending_domain' })
    } finally {
      delete process.env.SENDING_MANAGED
    }
  })

  it('pauses its sequences when the mailbox refuses the account, without using up an attempt, until it checks out again', async () => {
    contact('ava@larkspur.test')
    const id = sequenceFor(['ava@larkspur.test'])
    canSend()
    vi.mocked(sendMail).mockRejectedValueOnce(Object.assign(new Error('smtp.gmail.com: Message failed'), { code: 'EMESSAGE', responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded.' }))
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    expect(enrollment('ava@larkspur.test')).toMatchObject({ claim: null, attempts: 0, status: 'active' })
    expect(sendingOf()).toMatchObject({ status: 'paused', last_error: expect.stringMatching(/Daily user sending limit/) })
    expect(sequences.get(id).sequence).toMatchObject({ status: 'paused', auto_paused: 'mailbox' })
    expect(notices.at(-1)).toMatch(/"Intro" paused: Sending through jo@acme.test is paused/)

    // Still refused: it waits rather than going through the mail server.
    await runSequences(new Date(t0 + 60_000), () => 0)
    expect(sent).toHaveLength(0)

    await mailboxes.recheckSending('mb1', sendsFine)
    await runSequences(new Date(t0 + 2 * 60_000), () => 0)
    expect(sequences.get(id).sequence.status).toBe('active')
    expect(last()).toMatchObject({ to: 'ava@larkspur.test', via: { mailboxId: 'mb1' } })
  })

  it("keeps to the mailbox's own daily cap, across the sender's sequences", async () => {
    contact('ava@larkspur.test')
    contact('ben@larkspur.test')
    sequenceFor(['ava@larkspur.test'])
    sequenceFor(['ben@larkspur.test'])
    canSend({ daily_cap: 1 })
    const t0 = Date.now()
    await runSequences(new Date(t0), () => 0)
    await runSequences(new Date(t0 + 10 * 60_000), () => 0)
    expect(sent).toHaveLength(1)
  })

  it('records an email a restart cut off as sent the way it was going', async () => {
    contact('ava@larkspur.test')
    sequenceFor(['ava@larkspur.test'])
    canSend()
    vi.mocked(sendMail).mockImplementationOnce(() => new Promise(() => {}))
    void runSequences(new Date(), () => 0)
    await new Promise((r) => setTimeout(r, 20))
    expect(enrollment('ava@larkspur.test').claim).toMatchObject({ via: 'mailbox' })
    recoverClaims()
    expect(enrollment('ava@larkspur.test').sends[0]).toMatchObject({ uncertain: true, via: 'mailbox' })
    expect(db.data.campaign_recipients.find((r) => r.contact_email === 'ava@larkspur.test')).toMatchObject({ via: 'mailbox' })
  })

  it("doesn't add a follow-up it sent, found again in All Mail, to the conversation", async () => {
    contact('ava@larkspur.test')
    sequenceFor(['ava@larkspur.test'])
    const t0 = Date.now()
    canSend({}, { last_polled_at: iso(t0) })
    await runSequences(new Date(t0), () => 0)
    db.mutate(() => (db.data.mailboxes![0].last_polled_at = iso(t0 + 25 * 60 * 60_000)))
    await runSequences(new Date(t0 + 25 * 60 * 60_000), () => 0)
    const [first, follow] = enrollment('ava@larkspur.test').sends
    expect(follow).toMatchObject({ via: 'mailbox' })
    const inbox = fakeInbox([msg({ uid: 5, from: 'jo@acme.test', messageId: follow.message_id, inReplyTo: first.message_id, references: [first.message_id], subject: 'Re: Quick question' })])
    await pollMailboxes(new Date(t0 + 25 * 60 * 60_000 + 60_000), inbox.connect)
    expect(enrollment('ava@larkspur.test').messages ?? []).toHaveLength(0)
  })

  it("unsubscribes someone who presses their mail app's Unsubscribe, without counting it as a reply", async () => {
    contact('ava@larkspur.test')
    contact('ben@larkspur.test')
    sequenceFor(['ava@larkspur.test', 'ben@larkspur.test'])
    const t0 = Date.now()
    canSend({ daily_cap: 10 })
    await runSequences(new Date(t0), () => 0)
    await runSequences(new Date(t0 + 21 * 60_000), () => 0)
    const benFirst = enrollment('ben@larkspur.test').sends[0].message_id
    // Ben replied earlier; then both press Unsubscribe (Gmail's carries Auto-Submitted, and no words of theirs).
    await pollMailboxes(new Date(t0 + 30 * 60_000), fakeInbox([msg({ uid: 1, from: 'ben@larkspur.test', inReplyTo: benFirst, references: [benFirst] })]).connect)
    expect(enrollment('ben@larkspur.test').status).toBe('replied')
    notices.length = 0
    const unsubscribe = (uid: number, from: string) => msg({ uid, from, subject: 'unsubscribe', messageId: `<u${uid}@x>`, headers: { 'auto-submitted': 'auto-generated' } })
    await pollMailboxes(
      new Date(t0 + 60 * 60_000),
      fakeInbox([unsubscribe(2, 'ava@larkspur.test'), unsubscribe(3, 'ben@larkspur.test')], { sources: { 2: 'Content-Type: text/plain\r\n\r\n', 3: 'Content-Type: text/plain\r\n\r\nThis message was automatically generated by Gmail.' } }).connect,
    )
    for (const who of ['ava@larkspur.test', 'ben@larkspur.test']) {
      expect(db.getContact(who)?.status).toBe('unsubscribed')
      expect(db.emailStop(who)?.reason).toBe('unsubscribed')
    }
    expect(enrollment('ava@larkspur.test')).toMatchObject({ status: 'unsubscribed', reply: null, replied_at: null })
    expect(enrollment('ava@larkspur.test').messages ?? []).toHaveLength(0)
    expect(notices.filter((n) => n.startsWith('sequence_reply'))).toHaveLength(0)
  })

  it('checks inboxes connected before sending was, once, and says when their sequences move to the mailbox', async () => {
    connectInbox()
    await checkEarlierInboxes(async () => ({ ok: false, error: "couldn't log in", authFailed: true }))
    expect(db.data.mailboxes![0].sending).toMatchObject({ host: 'smtp.gmail.com', verified_at: null, status: 'ok', last_error: "couldn't log in" })
    expect(notices).toHaveLength(0)
    // Checked once: it isn't tried again by itself.
    let asked = 0
    await checkEarlierInboxes(async () => (asked++, { ok: true, sentAutosave: true }))
    expect(asked).toBe(0)

    connectInbox()
    await checkEarlierInboxes(sendsFine)
    expect(db.data.mailboxes![0].sending).toMatchObject({ verified_for: 'jo@acme.test', status: 'ok', daily_cap: 40 })
    expect(notices).toEqual([expect.stringMatching(/Sequence emails from jo@acme.test now go out through its own mailbox/)])
    expect(mailboxes.list()[0].sending).toMatchObject({ active: true, daily_cap: 40, sent_24h: 0 })
  })

  it('connects an inbox that reads but can’t send, for replies only, and keeps the sender’s choices when it’s checked again', async () => {
    const good = fakeInbox([])
    const cantSend = async () => ({ ok: false as const, error: 'smtp.gmail.com refused the login for sending.', authFailed: true })
    const saved = await mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', password: 'right' }, good.connect, undefined, cantSend)
    expect(saved).toMatchObject({ status: 'ok', sending: { active: false, verified_at: null, last_error: expect.stringMatching(/refused the login/) } })
    mailboxes.setSending(saved.id, { dailyCap: 25 })
    const again = await mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', password: 'right' }, good.connect, undefined, sendsFine)
    expect(again.sending).toMatchObject({ active: true, daily_cap: 25, last_error: null })
    mailboxes.setSending(saved.id, { useServer: true })
    expect(mailboxes.list()[0].sending).toMatchObject({ active: false, use_server: true })

    // Its own sending login: kept encrypted, never shown.
    await mailboxes.save({ senderId: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', smtp: { user: 'jo.send@acme.test', password: 'own-pass' } }, good.connect, undefined, sendsFine)
    expect(checked.at(-1)).toMatchObject({ user: 'jo.send@acme.test' })
    const shown = JSON.stringify(mailboxes.list())
    expect(shown).not.toMatch(/own-pass|app-pass|right|"secret"/)
    expect(mailboxes.list()[0].sending).toMatchObject({ user: 'jo.send@acme.test', has_own_password: true })
  })
})
