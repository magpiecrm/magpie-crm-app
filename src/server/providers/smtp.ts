import nodemailer from 'nodemailer'
import { getDescriptor } from './descriptors'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, OutboundMessage, ProviderCredentials } from './types'

// The transport is cached, but keyed on the credentials it was built from, so
// editing SMTP settings in the UI rebuilds it. The previous module-level
// singleton silently kept using stale credentials until the process restarted.
let cached: { key: string; transporter: nodemailer.Transporter } | null = null

function getTransporter(creds: ProviderCredentials): nodemailer.Transporter {
  const port = parseInt(creds.port, 10) || 465
  const key = `${creds.host}:${port}:${creds.user}:${creds.pass}`

  if (!cached || cached.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: creds.host,
        port,
        secure: port === 465, // true for 465, false for 587 or 25
        auth: { user: creds.user, pass: creds.pass },
      }),
    }
  }
  return cached.transporter
}

/** Drops the cached transport, so the next send rebuilds it. */
export function resetSmtpTransport(): void {
  cached = null
}

export const smtpProvider: EmailProvider = {
  descriptor: getDescriptor('smtp')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const mailOptions: any = {
      from: msg.from,
      to: msg.to.join(', '),
      subject: msg.subject,
      html: msg.html,
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
