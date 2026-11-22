// The single send choke point for the whole app.
//
// Despite the filename this is no longer SMTP-specific: it owns the shared
// concerns (header hygiene, address validation, the sender whitelist, the
// plan's allowance and usage, retries) and delegates the actual transport to
// whichever provider is configured in Settings (src/server/providers/), or,
// for a sequence email asked to go that way (`via`), to the sender's own
// mailbox (src/server/mailboxes/send.ts).

import { db } from './db'
import { env } from './env'
import { getActiveProviderConfig } from './emailSettings'
import { getProvider } from './providers'
import { ProviderSendError, type OutboundMessage } from './providers/types'
import { recordUsage } from './usage'
import { requireAllowance } from './allowance'
import { requireSendingDomain } from './sendingDomains'
import { sendThroughMailbox } from './mailboxes/send'

export { resetSmtpTransport } from './providers'

export interface SendMailOptions {
  from?: string
  to: string | string[]
  subject: string
  html: string
  campaignId?: number
  /** The recipient's unsubscribe link, sent as one-click List-Unsubscribe headers. */
  unsubscribeUrl?: string
  /** The plain-text part. Only SMTP makes one from the HTML when it's missing; the HTTP providers send none. */
  text?: string
  /** Threading for a follow-up (OutboundMessage): our Message-ID, the one it replies to, and the thread's. */
  messageId?: string
  inReplyTo?: string
  references?: string[]
  /**
   * Through this connected mailbox's own SMTP rather than the provider: a
   * sequence email, or an answer, from its sender (mailboxes/send.ts
   * sequenceRoute decides). Never set for campaigns or welcome emails.
   */
  via?: { mailboxId: string }
  /** With `via`: the opt-out as a mailto: List-Unsubscribe header, in place of a link. */
  unsubscribeMailto?: string
}

function cleanHeader(val: string): string {
  return val.replace(/[\r\n]+/g, '').trim()
}

function extractEmail(header: string): string {
  const match = header.match(/<([^>]+)>/)
  return (match ? match[1] : header).trim().toLowerCase()
}

function extractName(header: string): string {
  const match = header.match(/^\s*"?([^"<]*?)"?\s*</)
  return match ? match[1].trim() : ''
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function sendMail(options: SendMailOptions) {
  // Resolved once per call rather than per retry, so a settings change takes
  // effect on the next message without re-reading the DB three times.
  const config = getActiveProviderConfig()
  const defaultSender = config.defaultSender

  const rawFrom = options.from || defaultSender
  if (!rawFrom) {
    // Where the host sends there's no default sender setting: the first sender on a ready domain is used (emailSettings.ts).
    throw new Error(
      env.sendingManaged()
        ? 'There is no sender to send this from yet: add one in Settings → Mailboxes, on a domain that is ready in Settings → Sending.'
        : 'No sender configured — set a default sender in Settings → Sending.',
    )
  }

  const cleanFrom = cleanHeader(rawFrom)
  const cleanSubject = cleanHeader(options.subject)

  const toEmails = Array.isArray(options.to)
    ? options.to.map(cleanHeader)
    : [cleanHeader(options.to)]

  // Validate recipient emails
  for (const email of toEmails) {
    const parsedEmail = extractEmail(email)
    if (!isValidEmail(parsedEmail)) {
      throw new Error(`Invalid recipient email address: ${parsedEmail}`)
    }
  }

  // Validate sender email and check against whitelist
  const fromEmail = extractEmail(cleanFrom)
  if (!isValidEmail(fromEmail)) {
    throw new Error(`Invalid sender email address: ${fromEmail}`)
  }

  const isDefaultSender = defaultSender ? fromEmail === extractEmail(defaultSender) : false
  const isDbSender = db.query('SELECT id FROM senders WHERE LOWER(email) = ?').get(fromEmail) !== null

  if (!isDefaultSender && !isDbSender) {
    throw new Error(`Unauthorized sender address: ${fromEmail}`)
  }

  const message: OutboundMessage = {
    from: cleanFrom,
    fromEmail,
    fromName: extractName(cleanFrom) || undefined,
    to: toEmails,
    subject: cleanSubject,
    html: options.html,
    campaignId: options.campaignId,
    ...(options.unsubscribeUrl ? { unsubscribeUrl: options.unsubscribeUrl } : {}),
    ...(options.text !== undefined ? { text: options.text } : {}),
    ...(options.messageId ? { messageId: cleanHeader(options.messageId) } : {}),
    ...(options.inReplyTo ? { inReplyTo: cleanHeader(options.inReplyTo) } : {}),
    ...(options.references?.length ? { references: options.references.map(cleanHeader).filter(Boolean) } : {}),
  }

  // A demo copy (DEMO_MODE) sends nothing, and says it went: its contacts are
  // made up, and a throw would mark them bounced.
  if (env.demoMode()) {
    console.log(`[EMAIL DEMO] Not sent (demo copy): ${message.to.length} recipient(s).`)
    return { messageId: `demo-${crypto.randomUUID()}` }
  }

  // Retry transient network failures — callers treat a throw as a bounce,
  // so a momentary blip must not mark a recipient as bounced.
  const attemptSend = async () => {
    // Through the sender's own mailbox: their address is theirs to send from (no sending domain
    // needed here), and it counts against the plan's emails like any other.
    if (options.via) {
      requireAllowance('emailsSent', message.to.length)
      const sent = await sendThroughMailbox(options.via.mailboxId, message, options.unsubscribeMailto)
      recordUsage({ emailsSent: message.to.length })
      return sent
    }
    // A half-configured provider logs rather than throwing, which keeps local
    // development working and stops a missing key from bouncing a whole list.
    if (config.missingFields.length > 0 || config.credsUnreadable) {
      const why = config.credsUnreadable
        ? 'stored credentials could not be decrypted (encryption secret changed?)'
        : `missing ${config.missingFields.join(', ')}`
      console.warn(`[EMAIL MOCK] ${config.providerId} is not configured — ${why}. Logging instead of sending:`)
      console.warn(`From: ${message.from}`)
      console.warn(`To: ${message.to.join(', ')}`)
      console.warn(`Subject: ${message.subject}`)
      console.warn(`HTML: ${message.html.slice(0, 300)}...`)
      return { messageId: 'mock-id-' + Math.random().toString(36).substring(7) }
    }

    requireAllowance('emailsSent', message.to.length)
    requireSendingDomain(message.from)
    const sent = await getProvider(config.providerId).send(message, config.creds)
    recordUsage({ emailsSent: message.to.length })
    return sent
  }

  const RETRYABLE_CODES = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET']
  let lastError: any
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await attemptSend()
    } catch (err: any) {
      lastError = err
      // `retryable` covers provider HTTP 429/5xx, which are transient the same
      // way a socket error is — without it a blip permanently bounces a contact.
      const isNetworkError =
        RETRYABLE_CODES.includes(err?.code) ||
        /fetch failed|network/i.test(err?.message || '') ||
        err?.retryable === true
      if (!isNetworkError) throw withoutProviderName(err)
      console.warn(`[EMAIL] Transient send failure to ${toEmails.join(', ')} (attempt ${attempt}/3): ${err.code || err.message}`)
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
  throw withoutProviderName(lastError)
}

/** When the host runs sending, errors don't name its provider: that's the host's business. */
function withoutProviderName(err: unknown): unknown {
  if (err instanceof ProviderSendError && env.sendingManaged()) {
    err.message = `Email sending failed for ${err.recipient}: ${err.detail}`
  }
  return err
}
