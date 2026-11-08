import { afterAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// A sequence's conversations: what the Replies tab shows, and answering a
// reply from the app (threading, the quote, who it goes to, what stops it,
// and the copy in the inbox's Sent folder), on a scratch database.

const scratchDir = mkdtempSync(join(tmpdir(), 'conversation-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://app.example.test'

type Sent = { from?: string; to: string; subject: string; text?: string; html: string; messageId?: string; inReplyTo?: string; references?: string[]; campaignId?: number; unsubscribeUrl?: string }
const sent: Sent[] = []
vi.mock('../nodemailer', () => ({
  sendMail: vi.fn(async (msg: Sent) => {
    sent.push(msg)
    return { messageId: 'x' }
  }),
}))
vi.mock('../notify', () => ({ notify: () => {} }))

const { db } = await import('../db')
const { sequences } = await import('.')
const { runSequences } = await import('./engine')
const { conversations, sendReply } = await import('./conversation')
const { createDeal } = await import('../sales/deals')
const { ensurePipelines } = await import('../sales/pipelines')
const { encryptToken } = await import('../crypto')
const { env } = await import('../env')
type Connect = import('../mailboxes/imap').Connect

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

/** Her first email went two hours ago (moved back once sent), and she replied an hour later. */
const sentAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
const repliedAt = new Date(Date.now() - 60 * 60_000).toISOString()

const always = { days: [0, 1, 2, 3, 4, 5, 6], start_hour: 0, end_hour: 24, time_zone: 'Europe/London' }

function contact(email: string, status = 'subscribed') {
  db.mutate((d) => {
    d.contacts = d.contacts.filter((c) => c.email !== email)
    d.contacts.push({ email, first_name: 'Ava', last_name: 'Stone', job_title: '', company: 'Larkspur', status, created_at: new Date().toISOString() } as any)
  })
}

/** A fake inbox that only takes copies for its Sent folder. */
function sentFolder(opts: { fail?: boolean; noSent?: boolean } = {}) {
  const appended: string[] = []
  const connect = (async () => {
    if (opts.fail) throw new Error('connect ETIMEDOUT')
    return {
      appendSent: async (raw: Buffer) => {
        if (opts.noSent) return false
        appended.push(raw.toString('utf8'))
        return true
      },
      close: async () => {},
    }
  }) as unknown as Connect
  return { connect, appended }
}

function connectInbox() {
  db.mutate((d) => {
    d.mailboxes = [
      {
        id: 'mb1', sender_id: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test',
        secret: encryptToken({ password: 'app-pass' }, env.credentialsSecret()),
        status: 'ok', last_error: null, error_since: null, last_polled_at: new Date().toISOString(), folder: '[Gmail]/All Mail', uid_validity: '7', last_uid: 1,
        replies_found: 1, created_at: '', updated_at: '',
      },
    ]
  })
}

/** Ava in a sequence, her first email sent, and (unless `replied` is false) her reply kept. */
async function started(opts: { replied?: boolean } = {}) {
  contact('ava@larkspur.test')
  const s = sequences.create({ name: 'Intro', senderId: 1 }, null)
  sequences.update(s.id, {
    steps: [
      { delay_days: 0, subject: 'Quick question', body: 'Hi {{ contact.first_name }}, do you use a CRM?' },
      { delay_days: 3, subject: null, body: 'Following up' },
    ],
    settings: { ...always, signature: 'Jo' },
  })
  sequences.setStatus(s.id, 'active')
  sequences.enroll(s.id, ['ava@larkspur.test'], {}, null)
  await runSequences(new Date(), () => 0)
  expect(sent).toHaveLength(1)
  sent.length = 0
  const e = db.data.sequence_enrollments!.find((x) => x.contact_email === 'ava@larkspur.test')!
  db.mutate(() => void (e.sends[0].at = sentAt))
  const first = e.sends[0].message_id
  if (opts.replied !== false) {
    db.mutate(() => {
      e.status = 'replied'
      e.reply = { at: repliedAt, matched_by: 'thread' }
      e.replied_at = e.reply.at
      e.next_send_at = null
      e.messages = [
        {
          id: 'm1', direction: 'in', seen: false, message_id: '<r1@gmail.test>', in_reply_to: first, references: [first],
          from: 'ava.home@gmail.test', subject: 'Re: Quick question', at: repliedAt,
          text: 'Yes, a spreadsheet. Thursday?\n\nOn Tue, 4 Nov 2026, Jo wrote:\n> Hi Ava',
        },
      ]
    })
  }
  return { sequenceId: s.id, e, first }
}

beforeEach(() => {
  sent.length = 0
  db.mutate((d) => {
    d.sequences = []
    d.sequence_enrollments = []
    d.mailboxes = []
    d.email_stops = {}
    d.deals = []
    if (!d.senders.some((s) => s.id === 1)) d.senders.push({ id: 1, name: 'Jo', email: 'jo@acme.test' })
  })
})

describe('a conversation', () => {
  it('shows the sequence emails and the messages in order, and marks theirs as seen', async () => {
    const { sequenceId, e } = await started()
    connectInbox()
    const view = conversations.get(e.id)
    expect(view).toMatchObject({ name: 'Ava Stone', company: 'Larkspur', status: 'replied', inbox_connected: true, cannot_reply: null, signature: 'Jo', sender: { email: 'jo@acme.test' } })
    expect(view.items.map((i) => [i.kind, i.direction, i.from])).toEqual([
      ['step', 'out', 'Jo'],
      ['message', 'in', 'ava.home@gmail.test'],
    ])
    expect(view.items[0]).toMatchObject({ step: 1, subject: 'Quick question' })
    expect(view.items[0].text).toMatch(/^Hi Ava, do you use a CRM\?\n\nJo\n\n/)
    expect(view.items[0].edited_since).toBeUndefined()

    expect(sequences.enrollments(sequenceId)[0]).toMatchObject({ unread: 1, last_message: { direction: 'in', snippet: 'Yes, a spreadsheet. Thursday?' } })
    expect(sequences.enrollments(sequenceId)[0]).not.toHaveProperty('messages')
    expect(conversations.replies(sequenceId).map((x) => x.id)).toEqual([e.id])
    expect(conversations.unread(sequenceId)).toBe(1)
    expect(conversations.markSeen(e.id)).toEqual({ changed: 1 })
    expect(conversations.unread(sequenceId)).toBe(0)

    // The step edited since it went out: its words may not be what they got.
    const s = sequences.get(sequenceId).sequence
    sequences.update(sequenceId, { steps: [{ ...s.steps[0], body: 'Hello {{ contact.first_name }}' }, s.steps[1]] })
    expect(conversations.get(e.id).items[0]).toMatchObject({ edited_since: true })
  })
})

describe('answering a reply', () => {
  it('goes to whoever wrote, in their thread, with the sign-off and their message quoted, and a copy in Sent', async () => {
    const { e, first } = await started()
    connectInbox()
    const inbox = sentFolder()
    const { message, copied } = await sendReply(e.id, { text: 'Thursday works.\r\n', clientId: 'c-1' }, 'jo@acme.test', inbox.connect)
    expect(sent).toHaveLength(1)
    const mail = sent[0]
    expect(mail).toMatchObject({ from: '"Jo" <jo@acme.test>', to: 'ava.home@gmail.test', subject: 'Re: Quick question', inReplyTo: '<r1@gmail.test>', references: [first, '<r1@gmail.test>'] })
    expect(mail.messageId).toMatch(/^<[0-9a-f-]{36}@acme\.test>$/)
    // One person's answer: no tracking, no unsubscribe header.
    expect(mail.campaignId).toBeUndefined()
    expect(mail.unsubscribeUrl).toBeUndefined()
    const when = new Date(repliedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })
    expect(mail.text).toBe(`Thursday works.\n\nJo\n\nOn ${when}, ava.home@gmail.test wrote:\n> Yes, a spreadsheet. Thursday?\n>\n> On Tue, 4 Nov 2026, Jo wrote:\n> > Hi Ava`)
    expect(mail.html).toContain('<blockquote')
    expect(mail.html).toContain('Thursday works.<br>')

    expect(message).toMatchObject({ direction: 'out', via: 'app', client_id: 'c-1', message_id: mail.messageId, text: 'Thursday works.\n\nJo' })
    expect(await copied).toBe(true)
    expect(inbox.appended).toHaveLength(1)
    expect(inbox.appended[0]).toContain(`Message-ID: ${mail.messageId}`)
    expect(inbox.appended[0]).toContain('In-Reply-To: <r1@gmail.test>')
    expect(db.data.sequence_enrollments![0].messages!.at(-1)).toMatchObject({ sent_copy: true })

    // Sent again with the same id (a retry after a dropped response): nothing more goes.
    await sendReply(e.id, { text: 'Thursday works.', clientId: 'c-1' }, 'jo@acme.test', inbox.connect)
    expect(sent).toHaveLength(1)
    expect(conversations.get(e.id).items.map((i) => i.direction)).toEqual(['out', 'in', 'out'])
  })

  it("answers the sequence's email when the reply was marked by hand, and sends even if the Sent copy fails", async () => {
    const { e, first } = await started({ replied: false })
    sequences.act([e.id], 'mark_replied')
    connectInbox()
    const { copied } = await sendReply(e.id, { text: 'Good to talk earlier.', clientId: 'c-2' }, null, sentFolder({ fail: true }).connect)
    expect(sent[0]).toMatchObject({ to: 'ava@larkspur.test', subject: 'Re: Quick question', inReplyTo: first, references: [first], text: 'Good to talk earlier.\n\nJo' })
    expect(await copied).toBe(false)
    expect(db.data.sequence_enrollments![0].messages![0]).toMatchObject({ sent_copy: false })

    // Without an inbox connected, there's nowhere to put a copy.
    db.mutate((d) => void (d.mailboxes = []))
    expect(await (await sendReply(e.id, { text: 'And another thing.', clientId: 'c-3' }, null, sentFolder().connect)).copied).toBeNull()
  })

  it("won't answer someone who hasn't replied, has unsubscribed or bounced, or with nothing written", async () => {
    const { e } = await started({ replied: false })
    expect(conversations.get(e.id).cannot_reply).toMatch(/haven't replied yet/)
    await expect(sendReply(e.id, { text: 'Hi', clientId: 'c-4' }, null, sentFolder().connect)).rejects.toThrow(/haven't replied yet/)

    sequences.act([e.id], 'mark_replied')
    await expect(sendReply(e.id, { text: '   ', clientId: 'c-5' }, null, sentFolder().connect)).rejects.toThrow(/Write your answer/)
    db.stopEmail('ava@larkspur.test', 'unsubscribed')
    await expect(sendReply(e.id, { text: 'Hi', clientId: 'c-6' }, null, sentFolder().connect)).rejects.toThrow(/unsubscribed/)
    db.stopEmail('ava@larkspur.test', 'bounced')
    expect(conversations.get(e.id).cannot_reply).toMatch(/bounced/)
    expect(sent).toHaveLength(0)
  })
})

describe('the inbox', () => {
  it('lists replies across sequences, waits for an answer until one is sent or it is marked done, and asks again when they write', async () => {
    const { sequenceId, e } = await started()
    connectInbox()
    const row = () => conversations.inbox().rows.find((r) => r.enrollment_id === e.id)!
    expect(row()).toMatchObject({
      sequence: { id: sequenceId, name: 'Intro' },
      name: 'Ava Stone',
      company: 'Larkspur',
      at: repliedAt,
      last: { direction: 'in', snippet: 'Yes, a spreadsheet. Thursday?' },
      missing_reply: null,
      unread: 1,
      needs_reply: true,
      deal: null,
    })
    expect(conversations.inbox({ needsReply: true }).rows).toHaveLength(1)
    expect(conversations.inbox({ needsReply: false }).rows).toHaveLength(0)
    expect(conversations.inbox({ sequenceId: 'another' })).toMatchObject({ rows: [], needs_reply: 0, sequences: [{ id: sequenceId, name: 'Intro' }] })
    expect(conversations.waiting()).toBe(1)
    expect(conversations.get(e.id)).toMatchObject({ needs_reply: true, done: false, sequence_name: 'Intro' })

    // Marked done: not waiting, until she writes again.
    conversations.setDone(e.id, true)
    expect(conversations.waiting()).toBe(0)
    expect(conversations.get(e.id)).toMatchObject({ needs_reply: false, done: true })
    const later = new Date(Date.now() + 60_000).toISOString()
    db.mutate(() => void e.messages!.push({ id: 'm2', direction: 'in', seen: false, message_id: '<r2@gmail.test>', from: 'ava.home@gmail.test', subject: 'Re: Quick question', at: later, text: 'Any news?' }))
    expect(row()).toMatchObject({ needs_reply: true, at: later, last: { snippet: 'Any news?' }, unread: 2 })
    expect(conversations.get(e.id).done).toBe(false)

    // Answered, a minute after that: not waiting any more.
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => void vi.useRealTimers())
    vi.setSystemTime(Date.parse(later) + 60_000)
    await (await sendReply(e.id, { text: 'Thursday works.', clientId: 'c-10' }, 'jo@acme.test', sentFolder().connect)).copied
    expect(row()).toMatchObject({ needs_reply: false, last: { direction: 'out' } })
    expect(conversations.waiting()).toBe(0)
  })

  it("shows the person's deal, and doesn't wait on a stop, a reply marked by hand or one not read yet that can't be answered", async () => {
    const { e } = await started()
    db.mutate((d) => {
      ensurePipelines(d)
      createDeal(d, { name: 'Larkspur', contactEmails: ['ava@larkspur.test'] }, null)
    })
    const deal = conversations.get(e.id).deal!
    expect(deal).toMatchObject({ name: 'Larkspur', status: 'open' })
    expect(deal.stage).toBeTruthy()
    expect(conversations.inbox().rows[0].deal).toEqual(deal)

    // Unsubscribed (a "stop" reply does it): nothing to answer from here.
    db.stopEmail('ava@larkspur.test', 'unsubscribed')
    expect(conversations.inbox().rows[0].needs_reply).toBe(false)
    expect(conversations.waiting()).toBe(0)
  })

  it('says why a reply has no words: not read yet, not found, or marked by hand', async () => {
    const { e } = await started({ replied: false })
    sequences.act([e.id], 'mark_replied')
    expect(conversations.inbox().rows[0]).toMatchObject({ last: null, missing_reply: 'manual', needs_reply: false })
    expect(conversations.get(e.id).missing_reply).toBe('manual')

    // A reply found before replies' words were kept: waits, and says it's still to be read, then that it wasn't found.
    db.mutate(() => (e.reply = { at: repliedAt, matched_by: 'thread' }))
    expect(conversations.inbox().rows[0]).toMatchObject({ missing_reply: 'pending', needs_reply: true })
    db.mutate(() => (e.reply_searched_at = new Date().toISOString()))
    expect(conversations.get(e.id).missing_reply).toBe('not_found')
  })
})
