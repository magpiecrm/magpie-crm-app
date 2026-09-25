import { getDescriptor } from './descriptors'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, OutboundMessage, ProviderCredentials } from './types'

// Cloudflare Email Sending REST API. HTTPS only, so it works from hosts (like
// Railway) that block outbound SMTP ports — the reason this was the app's first
// non-SMTP path. Bounces do not arrive by webhook here: they are picked up by
// the GraphQL analytics poller in bouncePoller.ts.

export const cloudflareProvider: EmailProvider = {
  descriptor: getDescriptor('cloudflare')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const { accountId, apiToken } = creds
    let lastMessageId = ''

    // The API only accepts a single recipient string per request.
    for (const recipient of msg.to) {
      const payload: Record<string, unknown> = {
        from: msg.from,
        to: recipient,
        subject: msg.subject,
        html: msg.html,
      }
      const headers = campaignHeaders(msg)
      if (Object.keys(headers).length) payload.headers = headers

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      )

      const body: any = await response.json().catch(() => null)
      if (!response.ok || !body?.success) {
        const detail =
          body?.errors?.map((e: any) => e.message).join('; ') || response.statusText
        throw providerError('cloudflare', recipient, detail, response.status)
      }
      lastMessageId = body.result?.message_id || ''
    }

    return { messageId: lastMessageId }
  },
}
