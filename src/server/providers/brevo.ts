import { getDescriptor } from './descriptors'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

export const brevoProvider: EmailProvider = {
  descriptor: getDescriptor('brevo')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': creds.apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: msg.fromName
          ? { name: msg.fromName, email: msg.fromEmail }
          : { email: msg.fromEmail },
        to: msg.to.map((email) => ({ email })),
        subject: msg.subject,
        htmlContent: msg.html,
        headers: campaignHeaders(msg),
      }),
    })

    const body: any = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = body?.message || body?.code || response.statusText
      throw providerError('brevo', msg.to.join(', '), detail, response.status)
    }
    return { messageId: body?.messageId || '' }
  },

  // https://developers.brevo.com/docs/transactional-webhooks
  parseWebhook(body: unknown): NormalizedBounce[] {
    const evt = body as any
    const email = evt?.email
    if (!email) return []
    if (evt.event === 'hard_bounce' || evt.event === 'invalid_email') {
      return [{ email, type: 'hard', reason: evt.reason }]
    }
    if (evt.event === 'spam' || evt.event === 'complaint') {
      return [{ email, type: 'complaint' }]
    }
    if (evt.event === 'soft_bounce' || evt.event === 'blocked') {
      return [{ email, type: 'soft', reason: evt.reason }]
    }
    return []
  },
}
