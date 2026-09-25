import { getDescriptor } from './descriptors'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

export const resendProvider: EmailProvider = {
  descriptor: getDescriptor('resend')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        headers: campaignHeaders(msg),
      }),
    })

    const body: any = await response.json().catch(() => null)
    if (!response.ok || !body?.id) {
      const detail = body?.message || body?.error?.message || response.statusText
      throw providerError('resend', msg.to.join(', '), detail, response.status)
    }
    return { messageId: body.id }
  },

  // https://resend.com/docs/dashboard/webhooks/event-types
  parseWebhook(body: unknown): NormalizedBounce[] {
    const evt = body as any
    if (evt?.type !== 'email.bounced') return []
    const email = evt.data?.to?.[0]
    if (!email) return []
    // Resend reports bounceType as Permanent | Transient | Undetermined.
    const type = /permanent/i.test(evt.data?.bounce?.type || '') ? 'hard' : 'soft'
    return [{ email, type, reason: evt.data?.bounce?.message }]
  },
}
