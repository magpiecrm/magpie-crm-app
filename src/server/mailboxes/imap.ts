// Reading a connected inbox over IMAP (imapflow): which folder to read, and
// the headers of messages since the last one read. Only what's needed to
// tell a reply to a sequence email: ids, sender, subject, date and the
// auto-reply headers. A message's text is read (its first few kilobytes)
// only for one already matched to a sequence email (a "stop" reply) or a
// bounce report, and is never kept.

import { ImapFlow } from 'imapflow'

export interface MailboxLogin {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

export interface InboundMessage {
  uid: number
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  from: string | null
  subject: string
  date: string | null
  /** Lower-cased header names to their (unfolded) values, for the few headers fetched. */
  headers: Record<string, string>
}

export interface OpenedFolder {
  path: string
  uidValidity: string
  uidNext: number
}

export interface MailClient {
  /** Opens the folder to read (Gmail's All Mail, so archived replies count; else INBOX), read-only. */
  open(): Promise<OpenedFolder>
  /** Messages after `afterUid`, or since `since` when starting fresh, oldest first, at most `limit`. */
  fetch(from: { afterUid: number } | { since: Date }, limit: number): Promise<InboundMessage[]>
  /** The start of a message's raw source (headers and body), as text. */
  source(uid: number, maxBytes: number): Promise<string>
  close(): Promise<void>
}

export type Connect = (login: MailboxLogin) => Promise<MailClient>

const HEADERS = ['in-reply-to', 'references', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'content-type', 'x-failed-recipients', 'x-auto-response-suppress']

/** A header block's fields, unfolded, by lower-cased name. */
export function parseHeaderBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  let name: string | null = null
  for (const line of raw.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && name) {
      out[name] += ` ${line.trim()}`
      continue
    }
    const m = line.match(/^([!-9;-~]+):\s*(.*)$/)
    if (!m) {
      name = null
      continue
    }
    name = m[1].toLowerCase()
    out[name] = out[name] ? `${out[name]}, ${m[2].trim()}` : m[2].trim()
  }
  return out
}

/** Message ids in a header (`<a@b> <c@d>`), with their angle brackets. */
export function idsIn(value: string | null | undefined): string[] {
  return value ? [...value.matchAll(/<[^<>\s]+>/g)].map((m) => m[0]) : []
}

/** Logins over 15 seconds, and replies to commands over a minute, count as failed. */
function client(login: MailboxLogin) {
  return new ImapFlow({
    host: login.host,
    port: login.port,
    secure: login.secure,
    auth: { user: login.user, pass: login.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
}

export const imapConnect: Connect = async (login) => {
  const imap = client(login)
  await imap.connect()
  return {
    async open() {
      const folders = await imap.list()
      const all = folders.find((f) => f.specialUse === '\\All')
      const path = all?.path ?? 'INBOX'
      const box = await imap.mailboxOpen(path, { readOnly: true })
      return { path, uidValidity: String(box.uidValidity), uidNext: Number(box.uidNext ?? 1) }
    },
    async fetch(from, limit) {
      let range: string | number[]
      if ('afterUid' in from) {
        range = `${from.afterUid + 1}:*`
      } else {
        const found = await imap.search({ since: from.since }, { uid: true })
        if (!found || !found.length) return []
        range = found.slice(-limit)
      }
      const out: InboundMessage[] = []
      for await (const msg of imap.fetch(range, { uid: true, envelope: true, headers: HEADERS }, { uid: true })) {
        // `n:*` returns the last message even when it's older than n.
        if ('afterUid' in from && msg.uid <= from.afterUid) continue
        const headers = parseHeaderBlock(msg.headers?.toString('utf8') ?? '')
        const env = msg.envelope
        out.push({
          uid: msg.uid,
          messageId: env?.messageId ?? null,
          inReplyTo: idsIn(env?.inReplyTo ?? headers['in-reply-to'])[0] ?? null,
          references: idsIn(headers.references),
          from: env?.from?.[0]?.address?.toLowerCase() ?? null,
          subject: env?.subject ?? '',
          date: env?.date ? new Date(env.date).toISOString() : null,
          headers,
        })
        if (out.length >= limit) break
      }
      return out.sort((a, b) => a.uid - b.uid)
    },
    async source(uid, maxBytes) {
      const msg = await imap.fetchOne(String(uid), { source: { start: 0, maxLength: maxBytes } }, { uid: true })
      return msg && msg.source ? msg.source.toString('utf8') : ''
    },
    async close() {
      await imap.logout().catch(() => imap.close())
    },
  }
}

/** Whether a mail server is one of Zoho's: imap.zoho.com, imappro.zoho.eu, imappro.zohocloud.ca and so on. */
export const isZohoHost = (host: string) => /(^|\.)(zoho\.[a-z.]+|zohocloud\.ca)$/i.test(host.trim())

/**
 * The Zoho IMAP servers to try for an address, likeliest first. Zoho keeps
 * each account in one region (zoho.com, zoho.eu, zoho.in, …), with one
 * server for business accounts on their own domain (imappro) and another
 * for personal ones (imap), and a login only works at the right one. The
 * region is the one the address's domain has its mail delivered to (`mx`,
 * its MX hosts). Without that, the two commonest are tried.
 */
export function zohoHosts(mx: string[], asked?: string): string[] {
  const base = mx.map((h) => /(?:^|\.)(zoho\.[a-z.]+|zohocloud\.ca)\.?$/i.exec(h.trim())?.[1]?.toLowerCase().replace(/\.$/, '')).find(Boolean)
  const bases = base ? [base] : ['zoho.com', 'zoho.eu']
  const hosts = bases.flatMap((b) => [`imappro.${b}`, `imap.${b}`])
  // A server someone typed in themselves is tried first; the menu's own (imap.zoho.com) is only a placeholder.
  const typed = asked && isZohoHost(asked) && asked.toLowerCase() !== 'imap.zoho.com' ? [asked.toLowerCase()] : []
  return [...new Set([...typed, ...hosts])].slice(0, 4)
}

/** Whether an error from connecting means the login itself was refused. */
export function isAuthFailure(err: unknown): boolean {
  const e = err as { authenticationFailed?: boolean; responseText?: string; message?: string }
  return Boolean(e?.authenticationFailed) || /authenticat|invalid credentials|login failed|AUTHENTICATIONFAILED/i.test(`${e?.responseText ?? ''} ${e?.message ?? ''}`)
}

/** A connection error, in words a person can act on. */
export function describeError(err: unknown, host: string): string {
  const e = err as { code?: string; responseText?: string; message?: string }
  if (isAuthFailure(err)) {
    if (/gmail|googlemail/i.test(host)) return 'Gmail refused the login. Use an app password (Google Account → Security → App passwords), not your normal password.'
    if (isZohoHost(host)) {
      return "Zoho refused the login. Check that IMAP access is switched on for this address (Zoho Mail → Settings → Mail Accounts → IMAP Access), that the login is the full email address, and, if two-factor sign-in is on, that this is an application-specific password (your Zoho account → Security → App Passwords), not your normal one."
    }
    return 'The mail server refused the login: check the address and password.'
  }
  if (e?.code === 'ENOTFOUND') return `There's no mail server at ${host}.`
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || /timeout/i.test(e?.message ?? '')) return `Couldn't reach ${host}: check the server and port.`
  return e?.responseText || e?.message || 'Unknown error'
}
