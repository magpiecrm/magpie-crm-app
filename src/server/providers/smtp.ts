import nodemailer from 'nodemailer'
import { env } from '../env'
import { getDescriptor } from './descriptors'
import { htmlToText } from './plainText'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

// The transport is cached, but keyed on the credentials it was built from, so
// editing SMTP settings in the UI rebuilds it. The previous module-level
// singleton silently kept using stale credentials until the process restarted.
let cached: { key: string; transporter: nodemailer.Transporter } | null = null

/**
 * The name this copy introduces itself with (EHLO): its own address's
 * hostname. Otherwise nodemailer uses the machine's, which inside Docker
 * comes out as [127.0.0.1] in every email's Received header.
 */
function ehloName(): string | undefined {
  try {
    const url = env.publicUrl()
    return url ? new URL(url).hostname : undefined
  } catch {
    return undefined
  }
}

function getTransporter(creds: ProviderCredentials): nodemailer.Transporter {
  const port = parseInt(creds.port, 10) || 465
  const key = `${creds.host}:${port}:${creds.user}:${creds.pass}`

  if (!cached || cached.key !== key) {
    cached?.transporter.close()
    // The host's own mail server (SENDING_MANAGED): keep a few connections
    // open between messages rather than a new login for each, and never send
    // the login or the mail unencrypted.
    const managed = env.sendingManaged()
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: creds.host,
        port,
        secure: port === 465, // true for 465, false for 587 or 25
        auth: { user: creds.user, pass: creds.pass },
        ...(ehloName() ? { name: ehloName() } : {}),
        ...(managed ? { pool: true, maxConnections: 3, maxMessages: 500, requireTLS: port !== 465 } : {}),
      }),
    }
  }
  return cached.transporter
}

/** Drops the cached transport, so the next send rebuilds it. */
export function resetSmtpTransport(): void {
  cached?.transporter.close()
  cached = null
}

const EVENT_TYPES = new Set(['hard', 'soft', 'complaint'])

/**
 * An SMTP server doesn't report bounces itself; this reads the events the
 * host's mail server forwards (SENDING_MANAGED):
 *   { "events": [{ "email", "type": "hard" | "soft" | "complaint", "reason"? }] }
 */
function parseHostEvents(body: unknown): NormalizedBounce[] {
  const events = (body as any)?.events
  if (!Array.isArray(events)) return []
  return events
    .filter((e) => typeof e?.email === 'string' && e.email.includes('@') && EVENT_TYPES.has(e.type))
    .map((e) => ({ email: e.email, type: e.type, ...(typeof e.reason === 'string' ? { reason: e.reason } : {}) }))
}

export const smtpProvider: EmailProvider = {
  descriptor: getDescriptor('smtp')!,
  parseWebhook: parseHostEvents,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const mailOptions: any = {
      from: msg.from,
      to: msg.to.join(', '),
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? htmlToText(msg.html),
      ...(msg.messageId ? { messageId: msg.messageId } : {}),
      ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo } : {}),
      ...(msg.references?.length ? { references: msg.references } : {}),
    }
    const headers = campaignHeaders(msg)
    if (Object.keys(headers).length) mailOptions.headers = headers

    try {
      const info = await getTransporter(creds).sendMail(mailOptions)
      return { messageId: info.messageId || '' }
    } catch (err: any) {
      // Preserve nodemailer's error `code` so the shared retry loop can still
      // classify ECONNECTION/ETIMEDOUT/ESOCKET/ECONNRESET as transient.
      const wrapped = providerError('smtp', msg.to.join(', '), err?.message || String(err))
      ;(wrapped as any).code = err?.code
      throw wrapped
    }
  },
}
