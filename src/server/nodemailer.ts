// The single send choke point for the whole app.
//
// Despite the filename this is no longer SMTP-specific: it owns the shared
// concerns (header hygiene, address validation, the sender whitelist, retries)
// and delegates the actual transport to whichever provider is configured in
// Settings. See src/server/providers/ for the implementations.

import { db } from './db'
import { getActiveProviderConfig } from './emailSettings'
import { getProvider } from './providers'
import type { OutboundMessage } from './providers/types'
import { recordUsage } from './usage'
import { requireAllowance } from './allowance'
import { requireSendingDomain } from './sendingDomains'

export { resetSmtpTransport } from './providers'

export interface SendMailOptions {
  from?: string
  to: string | string[]
  subject: string
  html: string
  campaignId?: number
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
    throw new Error(
      'No sender configured — set a default sender in Settings → Sending.',
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
  }

  // Retry transient network failures — callers treat a throw as a bounce,
  // so a momentary blip must not mark a recipient as bounced.
  const attemptSend = async () => {
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
      if (!isNetworkError) throw err
      console.warn(`[EMAIL] Transient send failure to ${toEmails.join(', ')} (attempt ${attempt}/3): ${err.code || err.message}`)
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
  throw lastError
}
