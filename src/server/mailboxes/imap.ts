// Reading a connected inbox over IMAP (imapflow): which folder to read, and
// the headers of messages since the last one read. Only what's needed to
// tell a reply to a sequence email: ids, sender, subject, date and the
// auto-reply headers. A message's text is read only for one already matched
// to a sequence's conversation (kept with it, for the Replies tab) or a
// bounce report (never kept). The one thing written: a copy of an answer
// sent from the app, into the Sent folder.

import { ImapFlow, type MessageStructureObject } from 'imapflow'
import { htmlToText } from '../providers/plainText'

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

/** A message's words as plain text, and how many attachments it has (never read). */
export interface MessageText {
  text: string
  /** It went on past the most read, and was cut. */
  truncated: boolean
  attachments: number
}

export interface OpenedFolder {
  path: string
  uidValidity: string
  uidNext: number
}

export interface MailClient {
  /** Opens the folder to read (Gmail's All Mail, so archived replies count; else INBOX), read-only. */
  open(): Promise<OpenedFolder>
  /** Messages after `afterUid`, or since `since` when starting fresh (only those from `sender`, if given), oldest first, at most `limit`. */
  fetch(from: { afterUid: number } | { since: Date; sender?: string }, limit: number): Promise<InboundMessage[]>
  /** The start of a message's raw source (headers and body), as text. */
  source(uid: number, maxBytes: number): Promise<string>
  /** A message's words: its plain-text part, else its HTML as text, at most `maxChars`. */
  text(uid: number, maxChars: number): Promise<MessageText>
  /** Puts a copy of a message sent from the app in the Sent folder, as read; false when there's no Sent folder. */
  appendSent(raw: Buffer): Promise<boolean>
  close(): Promise<void>
}

export type Connect = (login: MailboxLogin) => Promise<MailClient>

const HEADERS = ['in-reply-to', 'references', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'content-type', 'x-failed-recipients', 'x-auto-response-suppress', 'x-mailtrace-verify']

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

/**
 * Where a message's words are, from its structure: its first plain-text
 * part and its first HTML part that aren't attachments, and how many
 * attachments it has. Images with a Content-ID are part of the HTML (a
 * logo in a signature), not attachments; a forwarded email is one.
 */
export function readStructure(root: MessageStructureObject): { plain: string | null; html: string | null; attachments: number } {
  const found = { plain: null as string | null, html: null as string | null, attachments: 0 }
  const walk = (node: MessageStructureObject) => {
    const type = (node.type ?? '').toLowerCase()
    const attached = (node.disposition ?? '').toLowerCase() === 'attachment'
    if (type === 'message/rfc822') {
      found.attachments++
      return
    }
    if (node.childNodes?.length) {
      for (const child of node.childNodes) walk(child)
      return
    }
    // A message that's one part has no part number: it's "1".
    const part = node.part ?? '1'
    if (!attached && type === 'text/plain') found.plain ??= part
    else if (!attached && type === 'text/html') found.html ??= part
    else if (attached || (!type.startsWith('text/') && !type.startsWith('multipart/') && !node.id)) found.attachments++
  }
  walk(root)
  return found
}

/** Logins over 15 seconds, and replies to commands over a minute, count as failed. */
function client(login: MailboxLogin) {
  const imap = new ImapFlow({
    host: login.host,
    port: login.port,
    secure: login.secure,
    auth: { user: login.user, pass: login.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
  // A failure already reported to whoever was waiting (a login the server hung up on, say) can
  // come again as an 'error' event, and an 'error' event nobody listens for crashes the app.
  imap.on('error', (err: Error) => console.warn(`[Mailboxes] ${login.host}: ${err?.message ?? err}`))
  return imap
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
        const found = await imap.search({ since: from.since, ...(from.sender ? { from: from.sender } : {}) }, { uid: true })
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
    async text(uid, maxChars) {
      const msg = await imap.fetchOne(String(uid), { bodyStructure: true }, { uid: true })
      const found = msg && msg.bodyStructure ? readStructure(msg.bodyStructure) : { plain: null, html: null, attachments: 0 }
      const part = found.plain ?? found.html
      if (!part) return { text: '', truncated: false, attachments: found.attachments }
      // Up to four bytes a character, and HTML's markup besides. Only that part is downloaded, decoded to UTF-8.
      const maxBytes = maxChars * (found.plain ? 4 : 12)
      const { meta, content } = await imap.download(String(uid), part, { uid: true, maxBytes })
      const chunks: Buffer[] = []
      for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      const words = (found.plain ? raw : htmlToText(raw)).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      return { text: words.slice(0, maxChars), truncated: words.length > maxChars || meta.expectedSize > maxBytes, attachments: found.attachments }
    },
    async appendSent(raw) {
      const sent = (await imap.list()).find((f) => f.specialUse === '\\Sent')
      if (!sent) return false
      await imap.append(sent.path, raw, ['\\Seen'], new Date())
      return true
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
  const e = err as { code?: string; responseText?: string; message?: string; reason?: string }
  if (isAuthFailure(err)) {
    if (/gmail|googlemail/i.test(host)) return 'Gmail refused the login. Use an app password (Google Account → Security → App passwords), not your normal password.'
    if (isZohoHost(host)) {
      return "Zoho refused the login. Check that IMAP access is switched on for this address (Zoho Mail → Settings → Mail Accounts → IMAP Access), that the login is the full email address, and, if two-factor sign-in is on, that this is an application-specific password (your Zoho account → Security → App Passwords), not your normal one."
    }
    return 'The mail server refused the login: check the address and password.'
  }
  if (e?.code === 'ENOTFOUND') return `There's no mail server at ${host}.`
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || /timeout/i.test(e?.message ?? '')) return `Couldn't reach ${host}: check the server and port.`
  // The server hung up, before the login was through (imapflow's "Unexpected close") or later, with its own reason when it gave one.
  if (/^ClosedAfterConnect/.test(e?.code ?? '') || e?.code === 'NoConnection') {
    return `${host} closed the connection${e.code === 'NoConnection' ? '' : ' while logging in'}${e.reason ? ` (${e.reason})` : ''}.`
  }
  return e?.responseText || e?.message || 'Unknown error'
}
