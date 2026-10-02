// Connected inboxes: each sender can connect theirs over IMAP so replies to
// sequence emails stop the sequence (and bounces and "stop" replies count).
// The email scheduler polls them every few minutes (pollMailboxes). The
// password is stored encrypted (CREDENTIALS_SECRET) and never shown again.

import { randomUUID } from 'node:crypto'
import { db, type DbSchema, type MailboxRecord } from '../db'
import { decryptToken, encryptToken } from '../crypto'
import { env } from '../env'
import { notify } from '../notify'
import type { Enrollment, MailboxView } from '../../features/sequences/types'
import { describeError, imapConnect, isAuthFailure, type Connect, type MailboxLogin } from './imap'
import { buildIndex, classifyInbound, isStopRequest, leadingText, matchReply, parseBounce } from './classify'

/** How far back the first read of an inbox looks, and the most messages read in one go. */
const FIRST_LOOK_MS = 7 * 86_400_000
const BATCH = 300
/** A message's start read for a stop request or a bounce report. */
const SOURCE_BYTES = 24_000
/** Replies to a sequence finished this long ago still count (a late reply is still a reply). */
const LATE_REPLY_MS = 30 * 86_400_000

const now = () => new Date().toISOString()

function view(data: DbSchema, m: MailboxRecord): MailboxView {
  const sender = data.senders.find((s) => s.id === m.sender_id)
  const { secret: _secret, uid_validity: _v, last_uid: _u, created_at: _c, updated_at: _up, ...rest } = m
  return { ...rest, sender: sender ? (sender.name ? `${sender.name} <${sender.email}>` : sender.email) : `Sender ${m.sender_id}` }
}

function loginOf(m: MailboxRecord): MailboxLogin | null {
  const secret = decryptToken(m.secret, env.credentialsSecret())
  return secret?.password ? { host: m.host, port: m.port, secure: m.secure, user: m.user, password: String(secret.password) } : null
}

/** Logs in and opens the folder it would read, then logs out. */
export async function testLogin(login: MailboxLogin, connect: Connect = imapConnect): Promise<{ ok: true; folder: string } | { ok: false; error: string; authFailed: boolean }> {
  try {
    const client = await connect(login)
    try {
      const folder = await client.open()
      return { ok: true, folder: folder.path }
    } finally {
      await client.close()
    }
  } catch (err) {
    return { ok: false, error: describeError(err, login.host), authFailed: isAuthFailure(err) }
  }
}

export const mailboxes = {
  list: (): MailboxView[] => (db.data.mailboxes ?? []).map((m) => view(db.data, m)),

  forSender: (senderId: number): MailboxView | null => {
    const m = db.data.mailboxes?.find((x) => x.sender_id === senderId)
    return m ? view(db.data, m) : null
  },

  /**
   * Connects (or reconnects) a sender's inbox, after checking the login
   * works. Leaving the password out keeps the saved one (changing the
   * server or address, say).
   */
  save: async (
    input: { senderId: number; host: string; port: number; secure: boolean; user: string; password?: string },
    connect: Connect = imapConnect,
  ): Promise<MailboxView> => {
    if (!db.data.senders.some((s) => s.id === input.senderId)) throw new Error('Sender not found')
    const existing = db.data.mailboxes?.find((m) => m.sender_id === input.senderId)
    const password = input.password || (existing ? loginOf(existing)?.password : undefined)
    if (!password) throw new Error('Enter the password (for Gmail, an app password).')
    const login: MailboxLogin = { host: input.host.trim().toLowerCase(), port: input.port, secure: input.secure, user: input.user.trim(), password }
    if (/(^|\.)(outlook\.office365\.com|office365\.com)$/i.test(login.host)) {
      throw new Error("Microsoft 365 doesn't allow password logins to your inbox, so it can't be connected this way yet. Mark replies by hand for now.")
    }
    const tested = await testLogin(login, connect)
    if (!tested.ok) throw new Error(tested.error)
    return db.mutate((data) => {
      const at = now()
      const record: MailboxRecord = {
        id: existing?.id ?? randomUUID(),
        sender_id: input.senderId,
        host: login.host,
        port: login.port,
        secure: login.secure,
        user: login.user,
        secret: encryptToken({ password }, env.credentialsSecret()),
        status: 'ok',
        last_error: null,
        error_since: null,
        // A new login (or a new inbox) is read from its first poll; the same one carries on.
        last_polled_at: existing && existing.host === login.host && existing.user === login.user ? existing.last_polled_at : null,
        folder: tested.folder,
        uid_validity: existing && existing.host === login.host && existing.user === login.user ? existing.uid_validity : null,
        last_uid: existing && existing.host === login.host && existing.user === login.user ? existing.last_uid : null,
        replies_found: existing?.replies_found ?? 0,
        created_at: existing?.created_at ?? at,
        updated_at: at,
      }
      data.mailboxes = [...(data.mailboxes ?? []).filter((m) => m.sender_id !== input.senderId), record]
      return view(data, record)
    })
  },

  remove: (id: string) =>
    db.mutate((data) => {
      data.mailboxes = (data.mailboxes ?? []).filter((m) => m.id !== id)
    }),
}

/** Sequence emails a mailbox's sender sent that a reply could answer, for matching. */
function enrollmentsFor(data: DbSchema, senderId: number, at: number): Enrollment[] {
  const sequences = new Set((data.sequences ?? []).filter((s) => s.sender_id === senderId).map((s) => s.id))
  return (data.sequence_enrollments ?? []).filter((e) => {
    if (!sequences.has(e.sequence_id) || !e.sends.length) return false
    if (e.status === 'active' || e.status === 'paused') return true
    return e.status === 'finished' && at - Date.parse(e.sends.at(-1)!.at) < LATE_REPLY_MS
  })
}

/**
 * Reads one inbox for new messages and acts on them: a reply stops that
 * person's sequence (and a "stop" reply unsubscribes them), a bounce report
 * records the bounce, out-of-office replies are ignored. Returns how many
 * replies it found.
 */
async function pollOne(m: MailboxRecord, at: Date, connect: Connect): Promise<number> {
  const sender = db.data.senders.find((s) => s.id === m.sender_id)
  if (!sender) return 0
  const enrollments = enrollmentsFor(db.data, m.sender_id, at.getTime())
  if (!enrollments.length) {
    // Nothing a reply could stop: nothing to read, and follow-ups aren't held back.
    db.mutate(() => (m.last_polled_at = at.toISOString()))
    return 0
  }
  const login = loginOf(m)
  if (!login) throw Object.assign(new Error("The saved password can't be read (the encryption secret changed). Reconnect the inbox."), { authenticationFailed: true })

  const client = await connect(login)
  let found = 0
  try {
    const folder = await client.open()
    const fresh = m.uid_validity !== folder.uidValidity || m.last_uid === null
    const since = new Date(Math.max(at.getTime() - FIRST_LOOK_MS, m.last_polled_at ? Date.parse(m.last_polled_at) - 86_400_000 : 0))
    const messages = await client.fetch(fresh ? { since } : { afterUid: m.last_uid! }, BATCH)
    const index = buildIndex(
      enrollments.map((e) => ({ item: e, email: e.contact_email, messageIds: e.sends.map((s) => s.message_id), firstSentAt: e.sends[0].at })),
    )
    const own = [sender.email, m.user]
    const { replyReceived } = await import('../sequences')
    for (const msg of messages) {
      const kind = classifyInbound(msg, own)
      if (kind === 'own' || kind === 'auto_reply') continue
      if (kind === 'bounce') {
        const bounce = parseBounce(await client.source(msg.uid, SOURCE_BYTES))
        const hit = bounce && index.byEmail.get(bounce.recipient)
        if (hit) {
          const last = hit.item.sends.at(-1)
          db.updateRecipientBounceStatus(bounce.recipient, bounce.hard ? 'hard' : 'soft', last ? String(last.campaign_id) : undefined)
        }
        continue
      }
      const match = matchReply(msg, index)
      if (!match || match.item.status === 'replied') continue
      const stop = isStopRequest(leadingText(await client.source(msg.uid, SOURCE_BYTES)))
      replyReceived(match.item.id, { at: msg.date ?? at.toISOString(), matched_by: match.by, stop })
      found++
    }
    const lastUid = messages.length ? Math.max(...messages.map((x) => x.uid)) : fresh ? folder.uidNext - 1 : m.last_uid
    db.mutate(() => {
      m.folder = folder.path
      m.uid_validity = folder.uidValidity
      m.last_uid = lastUid
      m.replies_found += found
    })
  } finally {
    await client.close().catch(() => {})
  }
  return found
}

/** Reads every connected inbox whose sender has sequence emails out. Run by the email scheduler. */
export async function pollMailboxes(at = new Date(), connect: Connect = imapConnect): Promise<void> {
  for (const m of db.data.mailboxes ?? []) {
    if (m.status === 'auth_failed') continue
    try {
      await pollOne(m, at, connect)
      db.mutate(() => {
        m.status = 'ok'
        m.last_error = null
        m.error_since = null
        m.last_polled_at = at.toISOString()
      })
    } catch (err) {
      const auth = isAuthFailure(err)
      const message = describeError(err, m.host)
      const first = m.status === 'ok'
      db.mutate(() => {
        m.status = auth ? 'auth_failed' : 'error'
        m.last_error = message
        m.error_since ??= at.toISOString()
      })
      console.error(`[Mailboxes] ${m.user}@${m.host}: ${message}`)
      if (auth || first) {
        notify('sequence_paused', `Reply detection for ${m.user} ${auth ? 'stopped' : "isn't working"}: ${message}`, { url: '/settings?tab=replies' })
      }
    }
  }
}
