import { getDescriptor } from './descriptors'
import { providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

function baseUrl(region: string): string {
  // Sending to the wrong region returns a confusing 401 rather than a redirect.
  return region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
}

export const mailgunProvider: EmailProvider = {
  descriptor: getDescriptor('mailgun')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const params = new URLSearchParams({
      from: msg.from,
      to: msg.to.join(', '),
      subject: msg.subject,
      html: msg.html,
      // We rewrite links and inject an open pixel ourselves; Mailgun's own
      // rewriting would wrap our /api/track/click URLs and break analytics.
      'o:tracking-clicks': 'no',
      'o:tracking-opens': 'no',
    })
    if (msg.campaignId) {
      // Mailgun takes arbitrary headers with an `h:` prefix.
      params.set('h:X-Campaign-ID', String(msg.campaignId))
    }

    const auth = Buffer.from(`api:${creds.apiKey}`).toString('base64')
    const response = await fetch(`${baseUrl(creds.region)}/v3/${creds.domain}/messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      // Passing URLSearchParams lets fetch set the form content-type itself.
      body: params,
    })

    const body: any = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = body?.message || response.statusText
      throw providerError('mailgun', msg.to.join(', '), detail, response.status)
    }
    return { messageId: body?.id || '' }
  },

  // https://documentation.mailgun.com/docs/mailgun/user-manual/events/
  parseWebhook(body: unknown): NormalizedBounce[] {
    const data = (body as any)?.['event-data']
    if (!data || data.event !== 'failed') return []
    const email = data.recipient
    if (!email) return []
    return [
      {
        email,
        type: data.severity === 'permanent' ? 'hard' : 'soft',
        reason: data['delivery-status']?.message || data.reason,
      },
    ]
  },
}
