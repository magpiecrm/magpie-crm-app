import { getDescriptor } from './descriptors'
import { signRequest } from './sigv4'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

const SES_PATH = '/v2/email/outbound-emails'

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

    if (notification?.notificationType !== 'Bounce' && notification?.eventType !== 'Bounce') {
      return []
    }

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
