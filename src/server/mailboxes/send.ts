// Sequence emails through the sender's own mailbox, over its SMTP server,
// rather than through the workspace's provider (on a hosted copy, the host's
// shared mail server). Cold email from a person's own Gmail or Zoho reaches
// the inbox where the same email from a shared server goes to spam, so once a
// sender's inbox is connected (for reply detection) and an email sent through
// it checks out (checkSending), that's how the sender's sequences go out:
// sequenceRoute. Only sequences, and answers to their replies; campaigns and
// welcome emails keep to the provider.
//
// What it holds to: a login every time (forceAuth), only the submission ports,
// never a private address, a daily cap and a few minutes between emails per
// mailbox, and a pause when the server refuses the account or too many bounce.
// A mailbox that has checked out and then fails pauses the sequences; they
// never quietly move to the shared server.

import nodemailer from 'nodemailer'
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { db, type DbSchema, type MailboxRecord, type MailboxSending } from '../db'
import { decryptToken } from '../crypto'
import { env } from '../env'
import { htmlToText } from '../providers/plainText'
import { isUnknownRecipient, type OutboundMessage } from '../providers/types'
import { withSmtpReply } from '../providers/smtp'
import type { MailboxSendingView } from '../../features/sequences/types'
import { imapConnect, isZohoHost, type Connect, type MailboxLogin } from './imap'

const DEFAULT_DAILY_CAP = 40
export const MAX_DAILY_CAP = 150
/** The submission ports: 587 with STARTTLS, 465 with TLS from the start. */
const SMTP_PORTS = [587, 465]

const DAY_MS = 86_400_000
/** Between one email and the next through a mailbox: this, and up to the jitter more. */
const GAP_MS = 90_000
const GAP_JITTER_MS = 60_000
/** A "try later" from the server holds the mailbox this long. */
const LATER_MS = 60 * 60_000
/** Bounces among its emails over this long, once there are enough to judge, pause the mailbox at this rate. */
const BOUNCE_WINDOW_MS = 7 * DAY_MS
const BOUNCE_MIN_SENDS = 20
const BOUNCE_MAX_RATE = 0.05
/** How long the sending check waits for its email to reach the inbox, in steps. */
const CHECK_WAITS_MS = [2_000, 3_000, 4_000, 5_000, 6_000]

export interface SmtpLogin {
  host: string
  port: number
  user: string
  password: string
}

/** The SMTP server that goes with an inbox's IMAP server, where it can be told; null when it has to be entered. */
export function smtpServerFor(imapHost: string): { host: string; port: number } | null {
  const h = imapHost.trim().toLowerCase()
  if (h === 'imap.gmail.com' || h === 'imap.googlemail.com') return { host: 'smtp.gmail.com', port: 587 }
  // Zoho's pair by region and kind of account: imappro.zoho.eu sends through smtppro.zoho.eu.
  if (isZohoHost(h)) return /^imap(pro)?\./.test(h) ? { host: h.replace(/^imap(pro)?\./, (_m, pro) => `smtp${pro ?? ''}.`), port: 587 } : null
  if (h === 'imap.mail.me.com') return { host: 'smtp.mail.me.com', port: 587 }
  // Fastmail and most others: imap.x goes with smtp.x; a "mail.x" server does both. The check finds out.
  if (/^imap\./.test(h)) return { host: h.replace(/^imap\./, 'smtp.'), port: 587 }
  if (/^mail\./.test(h)) return { host: h, port: 587 }
  return null
}

/** Whether an address is one that isn't on the internet (this machine, a private network, link-local, multicast). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  const x = ip.toLowerCase()
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff')
}

type Resolve = (host: string) => Promise<string[]>
const resolveAll: Resolve = async (host) => (await lookup(host, { all: true })).map((r) => r.address)

/** Why a server can't be sent through (a port that isn't for sending, an address that isn't public), or null. */
export async function serverProblem(login: Pick<SmtpLogin, 'host' | 'port'>, resolve: Resolve = resolveAll): Promise<string | null> {
  if (!SMTP_PORTS.includes(login.port)) return `Use port 587 or 465 for ${login.host}: those are the ports for sending.`
  const addresses = isIP(login.host) ? [login.host] : await resolve(login.host).catch(() => [] as string[])
  if (!addresses.length) return `There's no mail server at ${login.host}.`
  if (addresses.some(isPrivateAddress)) return `${login.host} isn't a mail server on the internet.`
  return null
}

const secretOf = (encrypted: string | undefined) => (encrypted ? decryptToken(encrypted, env.credentialsSecret()) : null)

/** A mailbox's SMTP login: its own where it has one, else the inbox's. Null when the password can't be read. */
function smtpLoginOf(box: MailboxRecord): SmtpLogin | null {
  const s = box.sending
  if (!s) return null
  const password = secretOf(s.secret)?.password ?? secretOf(box.secret)?.password
  return password ? { host: s.host, port: s.port, user: s.user || box.user, password: String(password) } : null
}

/** A sender's connected inbox. */
const boxOf = (senderId: number, data: DbSchema = db.data) => data.mailboxes?.find((m) => m.sender_id === senderId)

// One transport per mailbox, rebuilt when its login changes; no pooling (a few emails an hour).
const transports = new Map<string, { key: string; transporter: nodemailer.Transporter }>()

function newTransport(login: SmtpLogin, name: string): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: login.host,
    port: login.port,
    secure: login.port === 465,
    requireTLS: login.port !== 465,
    auth: { user: login.user, pass: login.password },
    // Logs in even where the server doesn't offer to: never sends unauthenticated from here.
    forceAuth: true,
    // Introduces itself as the sender's own domain, never this copy's address.
    name,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  } as any)
}

function transportFor(id: string, login: SmtpLogin, name: string): nodemailer.Transporter {
  const key = [login.host, login.port, login.user, createHash('sha256').update(login.password).digest('hex'), name].join(':')
  const cached = transports.get(id)
  if (cached?.key === key) return cached.transporter
  cached?.transporter.close()
  const transporter = newTransport(login, name)
  transports.set(id, { key, transporter })
  return transporter
}

/** Drops a mailbox's transport (disconnected, or its login changed). */
export function dropTransport(id: string) {
  transports.get(id)?.transporter.close()
  transports.delete(id)
}

/** An email as nodemailer takes it, with the opt-out as a mailto header (no link, no one-click POST). */
function mailOf(msg: OutboundMessage, unsubscribeMailto?: string) {
  return {
    from: msg.from,
    to: msg.to.join(', '),
    subject: msg.subject,
    html: msg.html,
    text: msg.text ?? htmlToText(msg.html),
    ...(msg.messageId ? { messageId: msg.messageId } : {}),
    ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo } : {}),
    ...(msg.references?.length ? { references: msg.references } : {}),
    ...(unsubscribeMailto ? { headers: { 'List-Unsubscribe': `<${unsubscribeMailto}>` } } : {}),
  }
}

/** The opt-out address for an email from `from`: a message to the sender saying "unsubscribe", which the inbox's reader acts on. */
export const unsubscribeMailto = (from: string) => `mailto:${from}?subject=unsubscribe`

/**
 * Sends one email through a mailbox that has checked out, as `sendMail` does
 * for the provider (it's called from there, with the allowance and usage
 * around it). The From must be the address it was checked sending as.
 */
export async function sendThroughMailbox(mailboxId: string, msg: OutboundMessage, mailto?: string, resolve: Resolve = resolveAll): Promise<{ messageId: string }> {
  const box = db.data.mailboxes?.find((m) => m.id === mailboxId)
  const s = box?.sending
  if (!box || !s?.verified_at) throw new Error("This sender's mailbox isn't set up to send.")
  if (msg.fromEmail !== (s.verified_for ?? '').toLowerCase()) throw new Error(`Unauthorized sender address: ${msg.fromEmail}`)
  const login = smtpLoginOf(box)
  if (!login) throw Object.assign(new Error("The saved password can't be read (the encryption secret changed). Reconnect the inbox."), { code: 'EAUTH' })
  const problem = await serverProblem(login, resolve)
  if (problem) throw Object.assign(new Error(problem), { code: 'EBADSERVER' })
  try {
    const info = await transportFor(box.id, login, msg.fromEmail.split('@')[1]).sendMail(mailOf(msg, mailto))
    return { messageId: info.messageId || msg.messageId || '' }
  } catch (err: any) {
    throw withSmtpReply(new Error(`${login.host}: ${err?.message ?? err}`), err)
  }
}

export type SmtpFailure = 'auth' | 'account' | 'later' | 'recipient' | 'other'

/**
 * What a refusal from a mailbox's server means: the login ('auth'), the
 * account can't send now (a daily limit, outgoing mail blocked, the address
 * not one it may send as: 'account'), try later ('later'), no such recipient,
 * or something about this one email.
 */
export function classifySmtpError(err: any): SmtpFailure {
  const code = Number(err?.responseCode)
  const text = `${err?.response ?? ''} ${err?.message ?? ''}`
  if (err?.code === 'EAUTH' || code === 534 || code === 535) return 'auth'
  if (isUnknownRecipient(err)) return 'recipient'
  if (code >= 500 && /\b5\.4\.5\b|\b5\.1\.8\b|quota|sending limit|limit exceeded|outgoing (mail )?(is )?blocked|not (owned|allowed|authori[sz]ed)|relay(ing)? (access )?(denied|not permitted|disallowed)|not allowed to relay|sender address rejected/i.test(text)) return 'account'
  if (err?.code === 'EBADSERVER') return 'account'
  if ((code >= 400 && code < 500) || ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS'].includes(err?.code)) return 'later'
  return 'other'
}

/** A refusal from a mailbox's server in words a person can act on. */
function describeSmtpError(err: any, host: string): string {
  if (classifySmtpError(err) === 'auth') {
    if (/gmail|google/i.test(host)) return 'Gmail refused the login for sending. Use an app password (Google Account → Security → App passwords), not your normal password.'
    if (isZohoHost(host)) return 'Zoho refused the login for sending. Check that SMTP access is on for this address and, with two-factor sign-in, that this is an application-specific password.'
    return `${host} refused the login for sending: check the login and password.`
  }
  if (err?.code === 'EBADSERVER') return String(err.message)
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(err?.code) || /timeout|ECONNREFUSED|ENOTFOUND/i.test(String(err?.message))) {
    return `Couldn't reach ${host} to send: check the server and port.`
  }
  const reply = typeof err?.response === 'string' ? err.response : String(err?.message ?? err).replace(new RegExp(`^${host.replace(/\./g, '\\.')}: `), '')
  return `${host} refused it: ${reply.slice(0, 300)}`
}

export type SequenceRoute = { via: 'server' } | { via: 'mailbox'; box: MailboxRecord } | { via: 'stopped'; box: MailboxRecord; reason: string }

/**
 * How a sender's sequence emails go out. Through their own mailbox once it
 * has checked out for that address (the default: nothing to switch on),
 * unless they chose the mail server instead; through the workspace's
 * provider when there's no inbox or it never checked out. A mailbox that
 * checked out but is refused now stops them ('stopped'): they wait for it
 * rather than go out a different way.
 */
export function sequenceRoute(sender: { id: number; email: string }, data: DbSchema = db.data): SequenceRoute {
  const box = boxOf(sender.id, data)
  const s = box?.sending
  if (!box || !s?.verified_at || s.use_server) return { via: 'server' }
  if ((s.verified_for ?? '').toLowerCase() !== sender.email.toLowerCase()) return { via: 'server' }
  if (s.status === 'ok') return { via: 'mailbox', box }
  const what = s.status === 'auth_failed' ? `${box.user} refused the login for sending` : `Sending through ${box.user} is paused`
  return {
    via: 'stopped',
    box,
    reason: `${what}${s.last_error ? ` (${s.last_error})` : ''}. Check it again in Settings → Mailboxes, or send this sender's sequences through the mail server there.`,
  }
}

/** A sender's sequence emails through their mailbox since a time, and their recipients' keys. */
function mailboxSends(data: DbSchema, senderId: number, sinceMs: number): { at: string; key: string }[] {
  const sequences = new Set((data.sequences ?? []).filter((s) => s.sender_id === senderId).map((s) => s.id))
  return (data.sequence_enrollments ?? []).flatMap((e) =>
    sequences.has(e.sequence_id) ? e.sends.filter((x) => x.via === 'mailbox' && Date.parse(x.at) >= sinceMs).map((x) => ({ at: x.at, key: `${x.campaign_id}:${e.contact_email}` })) : [],
  )
}

/** Sequence emails through a sender's mailbox in the last 24 hours. */
const sentInDay = (senderId: number, now: Date, data: DbSchema = db.data) => mailboxSends(data, senderId, now.getTime() - DAY_MS).length

/** Whether a mailbox may send a sequence email now: not held after a "try later", past the gap since the last, under its daily cap. */
export function mailboxRoom(box: MailboxRecord, now: Date, data: DbSchema = db.data): boolean {
  const s = box.sending
  if (!s) return false
  if (s.paused_until && Date.parse(s.paused_until) > now.getTime()) return false
  if (s.next_at && Date.parse(s.next_at) > now.getTime()) return false
  return sentInDay(box.sender_id, now, data) < s.daily_cap
}

/** After an email through a mailbox: the next waits a minute and a half to two and a half. */
export function noteMailboxSent(box: MailboxRecord, now: Date, random: () => number = Math.random) {
  db.mutate(() => {
    if (box.sending) box.sending.next_at = new Date(now.getTime() + GAP_MS + Math.floor(random() * GAP_JITTER_MS)).toISOString()
  })
}

/**
 * After a mailbox's server refused an email: a refused login or account
 * stops it (the sequences pause), a "try later" holds it for an hour.
 * Returns what kind of refusal it was.
 */
export function mailboxFailed(box: MailboxRecord, err: unknown, now: Date): SmtpFailure {
  const kind = classifySmtpError(err)
  const s = box.sending
  if (!s) return kind
  db.mutate(() => {
    if (kind === 'auth' || kind === 'account') {
      s.status = kind === 'auth' ? 'auth_failed' : 'paused'
      s.last_error = describeSmtpError(err, s.host)
      s.error_since ??= now.toISOString()
    } else if (kind === 'later') {
      s.paused_until = new Date(now.getTime() + LATER_MS).toISOString()
      s.last_error = describeSmtpError(err, s.host)
    }
  })
  return kind
}

/**
 * Pauses a mailbox when too many of its recent emails bounced (from the
 * bounce reports read from its inbox): a mailbox provider blocks an account
 * that keeps sending to addresses that don't exist. True if it paused it.
 */
export function bounceGuard(box: MailboxRecord, now: Date, data: DbSchema = db.data): boolean {
  const s = box.sending
  if (!s || s.status !== 'ok') return false
  const since = Math.max(now.getTime() - BOUNCE_WINDOW_MS, s.counted_from ? Date.parse(s.counted_from) : 0)
  const sends = mailboxSends(data, box.sender_id, since)
  if (sends.length < BOUNCE_MIN_SENDS) return false
  const keys = new Set(sends.map((x) => x.key))
  const bounced = data.campaign_recipients.filter((r) => r.via === 'mailbox' && r.status === 'bounced_hard' && keys.has(`${r.campaign_id}:${r.contact_email}`)).length
  if (bounced / sends.length < BOUNCE_MAX_RATE) return false
  db.mutate(() => {
    s.status = 'paused'
    s.last_error = `${bounced} of its last ${sends.length} sequence emails bounced, which can get the mailbox blocked. Check the addresses, then send through it again.`
    s.error_since = now.toISOString()
  })
  return true
}

/** A mailbox's sending as Settings shows it. */
export function sendingView(box: MailboxRecord, data: DbSchema = db.data, now = new Date()): MailboxSendingView | null {
  const s = box.sending
  if (!s) return null
  const sender = data.senders.find((x) => x.id === box.sender_id)
  return {
    host: s.host,
    port: s.port,
    user: s.user && s.user !== box.user ? s.user : null,
    has_own_password: !!s.secret,
    active: !!sender && sequenceRoute(sender, data).via === 'mailbox',
    verified_at: s.verified_at,
    use_server: !!s.use_server,
    daily_cap: s.daily_cap,
    status: s.status,
    last_error: s.last_error,
    sent_24h: sentInDay(box.sender_id, now, data),
  }
}

/** Which mail service a sending server is, for the host's counts: never the address. */
function serviceOf(host: string): 'google' | 'zoho' | 'icloud' | 'fastmail' | 'other' {
  const h = host.toLowerCase()
  if (/(^|\.)(gmail|googlemail|google)\.com$/.test(h)) return 'google'
  if (isZohoHost(h)) return 'zoho'
  if (/(^|\.)(me|icloud)\.com$/.test(h)) return 'icloud'
  if (/(^|\.)fastmail\.com$/.test(h)) return 'fastmail'
  return 'other'
}

/**
 * Each connected mailbox's sending, for the host (`/api/usage` `sending`):
 * its sender's domain, the service, whether sequences go through it, and its
 * last day's emails and last week's hard bounces. No addresses.
 */
export function mailboxSummaries(now = new Date(), data: DbSchema = db.data) {
  const bounced = new Set(data.campaign_recipients.filter((r) => r.via === 'mailbox' && r.status === 'bounced_hard').map((r) => `${r.campaign_id}:${r.contact_email}`))
  return (data.mailboxes ?? []).flatMap((m) => {
    const sender = data.senders.find((x) => x.id === m.sender_id)
    if (!m.sending || !sender) return []
    const week = mailboxSends(data, m.sender_id, now.getTime() - BOUNCE_WINDOW_MS)
    return [
      {
        domain: sender.email.split('@')[1]?.toLowerCase() ?? '',
        service: serviceOf(m.sending.host),
        active: sequenceRoute(sender, data).via === 'mailbox',
        status: m.sending.verified_at ? m.sending.status : ('unchecked' as const),
        cap: m.sending.daily_cap,
        sent24h: sentInDay(m.sender_id, now, data),
        sent7d: week.length,
        hardBounces7d: week.filter((x) => bounced.has(x.key)).length,
      },
    ]
  })
}

export type SendingCheck = { ok: true; sentAutosave: boolean } | { ok: false; error: string; authFailed: boolean }

export interface CheckDeps {
  connect?: Connect
  resolve?: Resolve
  wait?: (ms: number) => Promise<void>
}

/**
 * Sends one email through a mailbox to itself and looks for it in the inbox:
 * that the login sends, that the From stayed the sender's address (Gmail
 * rewrites an address that isn't one of the account's), and that the
 * Message-ID stayed ours (follow-ups thread on it). Whether it's also in Sent
 * says whether the service keeps a copy itself. Not counted as usage.
 */
export async function checkSending(sender: { name: string; email: string }, smtp: SmtpLogin, imap: MailboxLogin, deps: CheckDeps = {}): Promise<SendingCheck> {
  const problem = await serverProblem(smtp, deps.resolve)
  if (problem) return { ok: false, error: problem, authFailed: false }
  const domain = sender.email.split('@')[1] ?? 'localhost'
  const messageId = `<magpie-check-${randomUUID()}@${domain}>`
  const from = sender.name ? `"${sender.name.replace(/["\r\n]/g, '')}" <${sender.email}>` : sender.email
  const transporter = newTransport(smtp, domain)
  try {
    await transporter.sendMail({
      from,
      to: sender.email,
      subject: 'Sending check from MagpieCRM',
      text: `MagpieCRM sent this through your mailbox to check that ${sender.email}'s sequence emails can go out from here. Nothing needs doing; you can delete it.`,
      messageId,
    })
  } catch (err: any) {
    return { ok: false, error: describeSmtpError(err, smtp.host), authFailed: classifySmtpError(err) === 'auth' }
  } finally {
    transporter.close()
  }

  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const client = await (deps.connect ?? imapConnect)(imap).catch(() => null)
  if (!client?.find) return { ok: false, error: "The test email went, but the inbox couldn't be read to find it. Check again in a minute.", authFailed: false }
  try {
    for (const ms of CHECK_WAITS_MS) {
      await wait(ms)
      const found = await client.find(messageId).catch(() => null)
      if (!found || (!found.inRead && !found.inSent)) continue
      if (found.from && found.from !== sender.email.toLowerCase()) {
        return {
          ok: false,
          error: `${smtp.host} sent it as ${found.from}, not ${sender.email}. Add ${sender.email} as an address that mailbox can send from, or connect the mailbox that is ${sender.email}.`,
          authFailed: false,
        }
      }
      return { ok: true, sentAutosave: found.inSent }
    }
    return { ok: false, error: "The test email was sent but didn't reach the inbox within 20 seconds. Check again in a minute.", authFailed: false }
  } finally {
    await client.close().catch(() => {})
  }
}

/**
 * A mailbox's sending after a check: what it found, keeping the sender's own
 * choices (the cap, the mail server instead). One that had checked out and
 * now fails stays the route, stopped, so its sequences wait for it to be
 * fixed rather than go out through the mail server unasked.
 */
export function afterCheck(previous: MailboxSending | undefined, server: { host: string; port: number; user?: string; secret?: string }, check: SendingCheck, senderEmail: string, now: Date): MailboxSending {
  const at = now.toISOString()
  const wasRoute = !!previous?.verified_at
  return {
    host: server.host,
    port: server.port,
    ...(server.user ? { user: server.user } : {}),
    ...(server.secret ? { secret: server.secret } : {}),
    verified_at: check.ok ? at : (previous?.verified_at ?? null),
    verified_for: check.ok ? senderEmail.toLowerCase() : (previous?.verified_for ?? null),
    sent_autosave: check.ok ? check.sentAutosave : (previous?.sent_autosave ?? null),
    ...(previous?.use_server ? { use_server: true } : {}),
    daily_cap: previous?.daily_cap ?? DEFAULT_DAILY_CAP,
    status: check.ok || !wasRoute ? 'ok' : check.authFailed ? 'auth_failed' : 'paused',
    last_error: check.ok ? null : check.error,
    error_since: check.ok ? null : (previous?.error_since ?? at),
    paused_until: null,
    next_at: previous?.next_at ?? null,
    // Sending again after a pause: its bounces are counted afresh.
    counted_from: check.ok && previous?.status === 'paused' ? at : (previous?.counted_from ?? null),
  }
}
