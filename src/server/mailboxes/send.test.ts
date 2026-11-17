import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Sequence emails through the sender's own mailbox (send.ts): which server
// goes with an inbox, what it won't send through, how a refusal is read, how
// it's chosen as the way a sender's sequences go, its daily room, its bounce
// guard, and the check that an email through it reaches the inbox as sent.

const scratchDir = mkdtempSync(join(tmpdir(), 'mailbox-send-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const transports: any[] = []
const mails: any[] = []
let refuse: any = null
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: any) => {
      transports.push(options)
      return {
        sendMail: async (mail: any) => {
          if (refuse) throw refuse
          mails.push(mail)
          return { messageId: mail.messageId }
        },
        close: () => {},
      }
    },
  },
}))

const { db } = await import('../db')
const { encryptToken } = await import('../crypto')
const { env } = await import('../env')
const send = await import('./send')
const { smtpServerFor, isPrivateAddress, serverProblem, classifySmtpError, sequenceRoute, mailboxRoom, noteMailboxSent, bounceGuard, checkSending, afterCheck, sendThroughMailbox, dropTransport, mailboxSummaries } = send

afterAll(() => rmSync(scratchDir, { recursive: true, force: true }))

const publicDns = async () => ['142.250.102.108']
const sender = { id: 1, name: 'Jo', email: 'jo@acme.test' }
const now = new Date('2026-11-17T10:00:00Z')

function mailbox(sending: Partial<import('../db').MailboxSending> | null) {
  db.mutate((d) => {
    d.senders = d.senders.filter((s) => s.id !== 1)
    d.senders.push(sender)
    d.mailboxes = [
      {
        id: 'mb1', sender_id: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test',
        secret: encryptToken({ password: 'app-pass' }, env.credentialsSecret()),
        status: 'ok', last_error: null, error_since: null, last_polled_at: null, folder: null, uid_validity: null, last_uid: null,
        replies_found: 0, created_at: '', updated_at: '',
        ...(sending
          ? {
              sending: {
                host: 'smtp.gmail.com', port: 587, verified_at: '2026-11-16T09:00:00Z', verified_for: 'jo@acme.test', sent_autosave: true,
                daily_cap: 40, status: 'ok' as const, last_error: null, error_since: null, ...sending,
              },
            }
          : {}),
      },
    ]
  })
  return db.data.mailboxes![0]
}

/** Sequence emails a sender has sent through their mailbox: `count`, `minutesAgo` each, in one or two sequences. */
function sentThrough(times: string[], seqs = ['s1']) {
  db.mutate((d) => {
    d.sequences = seqs.map((id) => ({ id, sender_id: 1 }) as any)
    d.sequence_enrollments = times.map((at, i) => ({
      id: `e${i}`, sequence_id: seqs[i % seqs.length], contact_email: `p${i}@larkspur.test`, status: 'active',
      sends: [{ step_id: 'a', campaign_id: 9, message_id: `<m${i}@acme.test>`, subject: 'Hi', at, via: 'mailbox' }],
    }) as any)
    d.campaign_recipients = times.map((at, i) => ({ campaign_id: 9, contact_email: `p${i}@larkspur.test`, status: 'sent', opened_at: null, clicked_at: null, sent_at: at, via: 'mailbox' as const }))
  })
}

beforeEach(() => {
  transports.length = 0
  mails.length = 0
  refuse = null
  dropTransport('mb1')
  db.mutate((d) => {
    d.sequences = []
    d.sequence_enrollments = []
    d.campaign_recipients = []
    d.mailboxes = []
  })
})

describe('the sending server for an inbox', () => {
  it('goes with the IMAP server, on the submission port', () => {
    expect(smtpServerFor('imap.gmail.com')).toEqual({ host: 'smtp.gmail.com', port: 587 })
    expect(smtpServerFor('imappro.zoho.eu')).toEqual({ host: 'smtppro.zoho.eu', port: 587 })
    expect(smtpServerFor('imap.zoho.com')).toEqual({ host: 'smtp.zoho.com', port: 587 })
    expect(smtpServerFor('imappro.zohocloud.ca')).toEqual({ host: 'smtppro.zohocloud.ca', port: 587 })
    expect(smtpServerFor('imap.mail.me.com')).toEqual({ host: 'smtp.mail.me.com', port: 587 })
    expect(smtpServerFor('imap.fastmail.com')).toEqual({ host: 'smtp.fastmail.com', port: 587 })
    expect(smtpServerFor('mail.acme.test')).toEqual({ host: 'mail.acme.test', port: 587 })
    expect(smtpServerFor('box.acme.test')).toBeNull()
  })

  it("won't send through a port that isn't for sending, or an address that isn't on the internet", async () => {
    expect(await serverProblem({ host: 'smtp.gmail.com', port: 25 }, publicDns)).toMatch(/587 or 465/)
    expect(await serverProblem({ host: 'smtp.gmail.com', port: 587 }, publicDns)).toBeNull()
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.9', '172.20.0.2', '169.254.169.254', '100.85.238.50', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true)
      expect(await serverProblem({ host: 'smtp.evil.test', port: 587 }, async () => ['142.250.102.108', ip])).toMatch(/isn't a mail server on the internet/)
    }
    expect(isPrivateAddress('142.250.102.108')).toBe(false)
    expect(await serverProblem({ host: '127.0.0.1', port: 587 })).toMatch(/isn't a mail server on the internet/)
    expect(await serverProblem({ host: 'nowhere.test', port: 587 }, async () => [])).toMatch(/no mail server/)
  })
})

describe("a mailbox server's refusals", () => {
  it('tells the login, the account, try later, a missing recipient and the rest apart', () => {
    expect(classifySmtpError({ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted.' })).toBe('auth')
    expect(classifySmtpError({ code: 'EMESSAGE', responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded.' })).toBe('account')
    expect(classifySmtpError({ code: 'EENVELOPE', responseCode: 554, response: '554 5.1.8 Email Outgoing Blocked.' })).toBe('account')
    expect(classifySmtpError({ code: 'EENVELOPE', responseCode: 553, response: '553 Sender is not allowed to relay emails' })).toBe('account')
    expect(classifySmtpError({ code: 'EMESSAGE', responseCode: 421, response: '421 4.7.0 Try again later' })).toBe('later')
    expect(classifySmtpError({ code: 'ECONNECTION', message: 'Connection closed' })).toBe('later')
    expect(classifySmtpError({ code: 'EENVELOPE', responseCode: 550, response: '550-5.1.1 The email account that you tried to reach does not exist.' })).toBe('recipient')
    expect(classifySmtpError({ code: 'EMESSAGE', responseCode: 552, response: '552 5.2.2 Mailbox full' })).toBe('other')
  })
})

describe('the way a sender’s sequences go', () => {
  it('is their mailbox once it has checked out for that address, unless they chose the mail server', () => {
    expect(sequenceRoute(sender).via).toBe('server')
    mailbox(null)
    expect(sequenceRoute(sender).via).toBe('server')
    mailbox({ verified_at: null, verified_for: null })
    expect(sequenceRoute(sender).via).toBe('server')
    mailbox({})
    expect(sequenceRoute(sender).via).toBe('mailbox')
    mailbox({ use_server: true })
    expect(sequenceRoute(sender).via).toBe('server')
    // The sender's address changed since: the check was for another one.
    mailbox({ verified_for: 'old@acme.test' })
    expect(sequenceRoute(sender).via).toBe('server')
  })

  it('stops, rather than going another way, when the mailbox that checked out is refused', () => {
    mailbox({ status: 'auth_failed', last_error: 'Gmail refused the login for sending.' })
    const route = sequenceRoute(sender)
    expect(route.via).toBe('stopped')
    expect(route.via === 'stopped' && route.reason).toMatch(/refused the login for sending \(Gmail refused/)
  })
})

describe("a mailbox's room", () => {
  it('holds to its daily cap across all the sender’s sequences, and a few minutes between emails', () => {
    const box = mailbox({ daily_cap: 3 })
    sentThrough(['2026-11-17T08:00:00Z', '2026-11-17T09:00:00Z'], ['s1', 's2'])
    expect(mailboxRoom(box, now)).toBe(true)
    sentThrough(['2026-11-17T08:00:00Z', '2026-11-17T09:00:00Z', '2026-11-17T09:30:00Z'], ['s1', 's2'])
    expect(mailboxRoom(box, now)).toBe(false)
    // A day on, the earliest no longer count.
    expect(mailboxRoom(box, new Date('2026-11-18T08:30:00Z'))).toBe(true)

    sentThrough([])
    noteMailboxSent(box, now, () => 0.5)
    expect(box.sending!.next_at).toBe('2026-11-17T10:02:00.000Z')
    expect(mailboxRoom(box, new Date('2026-11-17T10:01:00Z'))).toBe(false)
    expect(mailboxRoom(box, new Date('2026-11-17T10:02:00Z'))).toBe(true)
    db.mutate(() => (box.sending!.paused_until = '2026-11-17T11:00:00Z'))
    expect(mailboxRoom(box, new Date('2026-11-17T10:30:00Z'))).toBe(false)
  })
})

describe('the bounce guard', () => {
  it('pauses a mailbox once 5% of 20 or more recent emails have bounced, and counts afresh after', () => {
    const box = mailbox({})
    const times = Array.from({ length: 20 }, (_, i) => new Date(now.getTime() - (i + 1) * 3_600_000).toISOString())
    sentThrough(times)
    expect(bounceGuard(box, now)).toBe(false)
    db.mutate((d) => (d.campaign_recipients[0].status = 'bounced_hard'))
    expect(bounceGuard(box, now)).toBe(true)
    expect(box.sending).toMatchObject({ status: 'paused' })
    expect(box.sending!.last_error).toMatch(/1 of its last 20 sequence emails bounced/)
    expect(sequenceRoute(sender).via).toBe('stopped')
    expect(mailboxSummaries(now)).toEqual([{ domain: 'acme.test', service: 'google', active: false, status: 'paused', cap: 40, sent24h: 20, sent7d: 20, hardBounces7d: 1 }])

    // Sent through again after checking: the earlier bounces don't count.
    db.mutate(() => Object.assign(box.sending!, { status: 'ok', counted_from: now.toISOString() }))
    expect(bounceGuard(box, new Date(now.getTime() + 60_000))).toBe(false)
  })
})

describe('sending through a mailbox', () => {
  it('logs in every time, as the sender’s own domain, with a mailto opt-out and nothing of the app', async () => {
    mailbox({})
    await sendThroughMailbox(
      'mb1',
      { from: '"Jo" <jo@acme.test>', fromEmail: 'jo@acme.test', to: ['ava@larkspur.test'], subject: 'Quick question', html: '<p>Hi</p>', text: 'Hi', campaignId: 9, unsubscribeUrl: 'https://acme.magpiecrm.com/api/unsubscribe?t=x', messageId: '<a@acme.test>' },
      'mailto:jo@acme.test?subject=unsubscribe',
      publicDns,
    )
    expect(transports[0]).toMatchObject({ host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true, forceAuth: true, name: 'acme.test', auth: { user: 'jo@acme.test', pass: 'app-pass' } })
    expect(transports[0]).not.toHaveProperty('pool')
    expect(mails[0]).toMatchObject({ messageId: '<a@acme.test>', text: 'Hi', headers: { 'List-Unsubscribe': '<mailto:jo@acme.test?subject=unsubscribe>' } })
    expect(JSON.stringify(mails[0])).not.toMatch(/magpiecrm|X-Campaign-ID|List-Unsubscribe-Post/)
  })

  it("won't send as anyone but the address it checked out for, nor before it has", async () => {
    mailbox({})
    const msg = { from: 'sam@acme.test', fromEmail: 'sam@acme.test', to: ['ava@larkspur.test'], subject: 'Hi', html: '<p>Hi</p>' }
    await expect(sendThroughMailbox('mb1', msg, undefined, publicDns)).rejects.toThrow(/Unauthorized sender/)
    mailbox({ verified_at: null })
    await expect(sendThroughMailbox('mb1', { ...msg, from: 'jo@acme.test', fromEmail: 'jo@acme.test' }, undefined, publicDns)).rejects.toThrow(/isn't set up to send/)
    expect(mails).toHaveLength(0)
  })

  it("keeps the server's reply on a refusal", async () => {
    mailbox({})
    refuse = Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Username and Password not accepted' })
    const err: any = await sendThroughMailbox('mb1', { from: 'jo@acme.test', fromEmail: 'jo@acme.test', to: ['ava@larkspur.test'], subject: 'Hi', html: '<p>Hi</p>' }, undefined, publicDns).catch((e) => e)
    expect(err).toMatchObject({ code: 'EAUTH', responseCode: 535 })
    expect(classifySmtpError(err)).toBe('auth')
  })
})

describe('checking a mailbox can send', () => {
  const smtp = { host: 'smtp.gmail.com', port: 587, user: 'jo@acme.test', password: 'app-pass' }
  const imap = { host: 'imap.gmail.com', port: 993, secure: true, user: 'jo@acme.test', password: 'app-pass' }
  const inbox = (found: (id: string) => { from: string | null; inRead: boolean; inSent: boolean } | null) =>
    (async () => ({ find: async (id: string) => found(id) ?? { from: null, inRead: false, inSent: false }, close: async () => {} })) as any
  const noWait = { resolve: publicDns, wait: async () => {} }

  it('sends one email to itself and finds it, from the sender, noting whether Sent keeps a copy', async () => {
    let asked = ''
    const result = await checkSending(sender, smtp, imap, { ...noWait, connect: inbox((id) => ((asked = id), { from: 'jo@acme.test', inRead: true, inSent: false })) })
    expect(result).toEqual({ ok: true, sentAutosave: false })
    expect(mails[0]).toMatchObject({ from: '"Jo" <jo@acme.test>', to: 'jo@acme.test', subject: 'Sending check from MagpieCRM' })
    expect(asked).toBe(mails[0].messageId)
    expect(transports[0]).toMatchObject({ forceAuth: true, name: 'acme.test' })
  })

  it("fails when the service sent it as another address, or it never arrives, or the login's refused", async () => {
    expect(await checkSending(sender, smtp, imap, { ...noWait, connect: inbox(() => ({ from: 'jo.personal@gmail.com', inRead: true, inSent: true })) })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/sent it as jo.personal@gmail.com, not jo@acme.test/),
    })
    expect(await checkSending(sender, smtp, imap, { ...noWait, connect: inbox(() => null) })).toMatchObject({ ok: false, error: expect.stringMatching(/didn't reach the inbox/) })
    refuse = Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 })
    expect(await checkSending(sender, smtp, imap, { ...noWait, connect: inbox(() => null) })).toMatchObject({ ok: false, authFailed: true, error: expect.stringMatching(/app password/) })
  })

  it('keeps a mailbox that had checked out as the way, stopped, when a later check fails', () => {
    const server = { host: 'smtp.gmail.com', port: 587 }
    const fail = { ok: false as const, error: 'nope', authFailed: false }
    const fresh = afterCheck(undefined, server, fail, 'jo@acme.test', now)
    expect(fresh).toMatchObject({ verified_at: null, status: 'ok', last_error: 'nope', daily_cap: 40 })
    const good = afterCheck(fresh, server, { ok: true, sentAutosave: true }, 'jo@acme.test', now)
    expect(good).toMatchObject({ verified_at: now.toISOString(), verified_for: 'jo@acme.test', status: 'ok', last_error: null, sent_autosave: true })
    const later = afterCheck({ ...good, daily_cap: 25, use_server: true }, server, { ...fail, authFailed: true }, 'jo@acme.test', now)
    expect(later).toMatchObject({ verified_at: now.toISOString(), status: 'auth_failed', daily_cap: 25, use_server: true })
  })
})
