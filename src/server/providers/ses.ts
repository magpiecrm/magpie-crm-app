import { getDescriptor } from './descriptors'
import { signRequest } from './sigv4'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

const SES_PATH = '/v2/email/outbound-emails'

/** https://sns.<region>.amazonaws.com/… : where AWS's subscription confirmations live. */
export function isSnsUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname)
  } catch {
    return false
  }
}

/** "workspace=acme,team=sales" → SES EmailTags; SES allows letters, numbers, _ - . @ in both. */
export function parseMessageTags(raw: string | undefined): Array<{ Name: string; Value: string }> {
  return (raw ?? '')
    .split(',')
    .map((pair) => pair.split('=').map((s) => s.trim()))
    .filter(([name, value]) => name && value && /^[\w.@-]{1,256}$/.test(name) && /^[\w.@-]{1,256}$/.test(value))
    .map(([Name, Value]) => ({ Name, Value }))
}

export const sesProvider: EmailProvider = {
  descriptor: getDescriptor('ses')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const region = creds.region || 'us-east-1'
    const host = `email.${region}.amazonaws.com`

    const headers = campaignHeaders(msg)
    const payload: Record<string, unknown> = {
      FromEmailAddress: msg.from,
      Destination: { ToAddresses: msg.to },
      Content: {
        Simple: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: msg.html, Charset: 'UTF-8' } },
          ...(Object.keys(headers).length
            ? { Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })) }
            : {}),
        },
      },
    }
    // Required for SES to publish bounce/complaint events to SNS.
    if (creds.configurationSet) payload.ConfigurationSetName = creds.configurationSet
    // SES_MESSAGE_TAGS ("workspace=acme"): comes back on every event, e.g. so a
    // host can tell which of its copies a bounce belongs to.
    const tags = parseMessageTags(creds.messageTags)
    if (tags.length) payload.EmailTags = tags

    const body = JSON.stringify(payload)
    const signed = signRequest({
      method: 'POST',
      host,
      path: SES_PATH,
      region,
      service: 'ses',
      body,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    })

    const response = await fetch(`https://${host}${SES_PATH}`, {
      method: 'POST',
      headers: signed,
      body,
    })

    const json: any = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = json?.message || json?.Message || response.statusText
      throw providerError('ses', msg.to.join(', '), detail, response.status)
    }
    return { messageId: json?.MessageId || '' }
  },

  /**
   * SES delivers events through SNS, so the payload is an SNS envelope whose
   * `Message` is itself a JSON string.
   * https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
   */
  parseWebhook(body: unknown): NormalizedBounce[] {
    const envelope = body as any
    let notification: any = envelope

    if (typeof envelope?.Message === 'string') {
      try {
        notification = JSON.parse(envelope.Message)
      } catch {
        return []
      }
    }

    const kind = notification?.eventType ?? notification?.notificationType
    if (kind === 'Complaint') {
      // Someone marked the email as spam: never email them again.
      const complained: any[] = notification.complaint?.complainedRecipients || []
      return complained
        .filter((r) => r?.emailAddress)
        .map((r) => ({ email: r.emailAddress, type: 'complaint' as const, reason: notification.complaint?.complaintFeedbackType }))
    }
    if (kind !== 'Bounce') return []

    const bounce = notification.bounce
    const recipients: any[] = bounce?.bouncedRecipients || []
    // SES reports Permanent | Transient | Undetermined.
    const type = bounce?.bounceType === 'Permanent' ? 'hard' : 'soft'

    return recipients
      .filter((r) => r?.emailAddress)
      .map((r) => ({
        email: r.emailAddress,
        type: type as 'hard' | 'soft',
        reason: r.diagnosticCode,
      }))
  },
}
