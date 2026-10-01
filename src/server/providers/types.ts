// Shared types for the pluggable email-sending providers.
//
// This module is imported by the Settings UI as well as the server, so it must
// stay free of node/server imports — types and plain data only.

export type ProviderId =
  | 'cloudflare'
  | 'brevo'
  | 'ses'
  | 'postmark'
  | 'sendgrid'
  | 'mailgun'
  | 'resend'
  | 'mailchimp'
  | 'smtp'

type FieldType = 'text' | 'secret' | 'number' | 'select'

export interface ProviderField {
  key: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  /** Short hint shown under the input — usually where to find the value. */
  help?: string
  /** Only meaningful for `type: 'select'`. */
  options?: Array<{ value: string; label: string }>
  /** Used when the field is absent from the stored credentials. */
  defaultValue?: string
}

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  /** One-line pitch shown next to the provider in the picker. */
  summary: string
  docsUrl: string
  /**
   * False for providers that need outbound SMTP ports, which are blocked on
   * hosts like Railway. Surfaced as a warning in the UI rather than hidden,
   * since it works fine for local and self-hosted deployments.
   */
  httpsOnly: boolean
  fields: ProviderField[]
}

/**
 * A message that has already passed the shared validation in `sendMail` —
 * headers are CRLF-clean, recipients and sender are valid addresses.
 */
export interface OutboundMessage {
  /** Raw RFC-5322 header, e.g. `"Acme" <hi@acme.com>`. */
  from: string
  /** Bare address extracted from `from`. */
  fromEmail: string
  /** Display name from `from`, when it had one. */
  fromName?: string
  to: string[]
  subject: string
  html: string
  campaignId?: number
  /** This recipient's unsubscribe link, for the List-Unsubscribe headers. */
  unsubscribeUrl?: string
  /** The plain-text part; made from the HTML when missing. */
  text?: string
  /**
   * Threading, for a follow-up in the same conversation (sequences): our own
   * Message-ID (`<id@domain>`), the message it replies to, and the thread's
   * earlier ones. The SMTP provider sends all three; HTTP providers that take
   * custom headers get In-Reply-To and References (threadHeaders), and set
   * their own Message-ID.
   */
  messageId?: string
  inReplyTo?: string
  references?: string[]
}

interface ProviderSendResult {
  messageId: string
}

/** A bounce event normalized out of a provider's webhook payload. */
export interface NormalizedBounce {
  email: string
  /** 'complaint': the recipient marked the email as spam. Only 'hard' stops email to them; 'soft' is a failed attempt. */
  type: 'hard' | 'soft' | 'complaint'
  campaignId?: number
  reason?: string
}

export type ProviderCredentials = Record<string, string>

export interface EmailProvider {
  descriptor: ProviderDescriptor
  send(msg: OutboundMessage, creds: ProviderCredentials): Promise<ProviderSendResult>
  /**
   * Translates a provider webhook body into bounce events. Providers that have
   * no webhook support (or whose bounces arrive another way, like Cloudflare's
   * analytics poller) simply omit this.
   */
  parseWebhook?(body: unknown): NormalizedBounce[]
}

/**
 * Headers for campaign email: `X-Campaign-ID`, and one-click unsubscribe
 * (RFC 8058) when there's an unsubscribe link, so mail clients show their own
 * Unsubscribe button. Gmail and Yahoo require it of bulk senders.
 */
export function campaignHeaders(msg: OutboundMessage): Record<string, string> {
  return {
    ...(msg.campaignId ? { 'X-Campaign-ID': String(msg.campaignId) } : {}),
    ...(msg.unsubscribeUrl
      ? { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : {}),
  }
}

/** In-Reply-To and References for a follow-up, for providers that accept them as custom headers. */
export function threadHeaders(msg: OutboundMessage): Record<string, string> {
  return {
    ...(msg.inReplyTo ? { 'In-Reply-To': msg.inReplyTo } : {}),
    ...(msg.references?.length ? { References: msg.references.join(' ') } : {}),
  }
}

/**
 * Providers report failures in wildly different shapes; funnel them all through
 * this so the campaign loop and the retry classifier see one consistent format.
 *
 * `retryable` matters because a thrown error marks the recipient `bounced_soft`
 * in `emailService.sendCampaign`. A 429 or a provider 5xx is a transient blip,
 * not a bad address, so it must be retried rather than recorded as a bounce.
 */
export class ProviderSendError extends Error {
  readonly provider: ProviderId
  readonly recipient: string
  readonly detail: string
  readonly status?: number
  readonly retryable: boolean

  constructor(provider: ProviderId, recipient: string, detail: string, status?: number) {
    super(`${provider} email sending failed for ${recipient}: ${detail}`)
    this.name = 'ProviderSendError'
    this.provider = provider
    this.recipient = recipient
    this.detail = detail
    this.status = status
    this.retryable = status === 429 || (status !== undefined && status >= 500)
  }
}

/**
 * A send refused because the address doesn't exist: a hard bounce, so the
 * contact isn't emailed again. An SMTP 550-553 saying so (or with a 5.1.x
 * status), or a provider's own words for it. Anything else refused at send
 * time (a policy block, a full mailbox, rate limits) is only a failed attempt.
 */
export function isUnknownRecipient(err: any): boolean {
  const text = `${err?.response ?? ''} ${err?.detail ?? ''} ${err?.message ?? ''}`
  const code = Number(err?.responseCode)
  if (code >= 550 && code <= 553) {
    return /\b5\.1\.[0-3]\b|user unknown|unknown (user|recipient)|no such (user|mailbox|recipient)|does ?n[o']t exist|mailbox (unavailable|not found)|recipient (address )?rejected|invalid (recipient|mailbox)/i.test(text)
  }
  return /\b(invalid|unknown|non-?existent) recipient\b|recipient address rejected|no such (user|mailbox)/i.test(text)
}

export function providerError(
  provider: ProviderId,
  recipient: string,
  detail: string,
  status?: number,
): ProviderSendError {
  return new ProviderSendError(provider, recipient, detail, status)
}
