// The test stack's mail, for tests and agents:
//
//   Mailpit    catches every email the app sends, whoever it's addressed to:
//              `sent()` / `waitForSent()` read it (also at the web view in state.mail.webUrl).
//   GreenMail  holds the senders' inboxes the app reads for replies (IMAP, auth off):
//              `deliver()` puts an email in one (a prospect's reply), `inbox()` reads one
//              (e.g. the Sent copy of an answer).
//
// Nothing here can reach a real inbox.

import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import PostalMime from 'postal-mime'
import { readState } from './state'

export interface CapturedMail {
  id: string
  messageId: string
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  /** Header names lower-cased; values joined with ", " where a header repeats. */
  headers: Record<string, string>
  date: string
}

const api = (path: string, init?: RequestInit) => fetch(`${readState().mail.webUrl}/api/v1${path}`, init)

/** Every email the app has sent (oldest first), or only those to one address. */
export async function sent(to?: string): Promise<CapturedMail[]> {
  const list = (await (await api(`/messages?limit=1000`)).json()) as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> }
  const wanted = list.messages.filter((m) => !to || m.To.some((a) => a.Address.toLowerCase() === to.toLowerCase())).reverse()
  return Promise.all(
    wanted.map(async ({ ID }) => {
      const m = (await (await api(`/message/${ID}`)).json()) as any
      const headers = (await (await api(`/message/${ID}/headers`)).json()) as Record<string, string[]>
      return {
        id: ID,
        messageId: m.MessageID,
        from: m.From?.Address ?? '',
        to: (m.To ?? []).map((a: { Address: string }) => a.Address),
        subject: m.Subject,
        html: m.HTML ?? '',
        text: m.Text ?? '',
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.join(', ')])),
        date: m.Date,
      }
    }),
  )
}

/** Waits until the app has sent at least `count` emails to an address (the scheduler runs once a minute). */
export async function waitForSent(to: string, { count = 1, timeoutMs = 100_000, match }: { count?: number; timeoutMs?: number; match?: (m: CapturedMail) => boolean } = {}) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const mails = (await sent(to)).filter(match ?? (() => true))
    if (mails.length >= count) return mails
    if (Date.now() > until) throw new Error(`${to} was sent ${mails.length} of ${count} expected emails in ${timeoutMs / 1000}s`)
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/** Puts an email into a sender's inbox, as if someone had sent it there (e.g. a reply to a sequence email). */
export async function deliver(message: { from: string; to: string; subject: string; text: string; inReplyTo?: string; references?: string; headers?: Record<string, string> }) {
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: readState().mail.inboxSmtpPort, secure: false, ignoreTLS: true })
  await transport.sendMail(message)
}

/** What's in one of a sender's inbox folders, oldest first. */
export async function inbox(address: string, folder = 'INBOX'): Promise<CapturedMail[]> {
  // With auth off, GreenMail opens the inbox on first login, whatever the password.
  const imap = new ImapFlow({ host: '127.0.0.1', port: readState().mail.imapPort, secure: false, auth: { user: address, pass: 'x' }, logger: false })
  await imap.connect()
  try {
    const lock = await imap.getMailboxLock(folder)
    try {
      const out: CapturedMail[] = []
      if (!(imap.mailbox && imap.mailbox.exists)) return out
      for await (const msg of imap.fetch('1:*', { uid: true, source: true })) {
        if (!msg.source) continue
        const parsed = await PostalMime.parse(msg.source)
        out.push({
          id: String(msg.uid),
          messageId: parsed.messageId ?? '',
          from: parsed.from?.address ?? '',
          to: (parsed.to ?? []).map((a) => a.address ?? '').filter(Boolean),
          subject: parsed.subject ?? '',
          html: parsed.html ?? '',
          text: parsed.text ?? '',
          headers: Object.fromEntries(parsed.headers.map((h) => [h.key.toLowerCase(), h.value])),
          date: parsed.date ?? '',
        })
      }
      return out
    } finally {
      lock.release()
    }
  } finally {
    await imap.logout().catch(() => {})
  }
}

/** Makes folders in a sender's inbox: GreenMail starts each with only INBOX, where a real one has Sent too. */
export async function ensureFolders(address: string, folders = ['Sent']) {
  const imap = new ImapFlow({ host: '127.0.0.1', port: readState().mail.imapPort, secure: false, auth: { user: address, pass: 'x' }, logger: false })
  await imap.connect()
  try {
    const have = new Set((await imap.list()).map((f) => f.path))
    for (const f of folders) if (!have.has(f)) await imap.mailboxCreate(f)
  } finally {
    await imap.logout().catch(() => {})
  }
}

/** Forgets every email sent and empties every inbox. */
export async function purgeMail() {
  const { mail } = readState()
  await api('/messages', { method: 'DELETE' })
  await fetch(`http://127.0.0.1:${mail.inboxApiPort}/api/mail/purge`, { method: 'POST' })
}
