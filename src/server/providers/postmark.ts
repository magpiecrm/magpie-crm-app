import { getDescriptor } from './descriptors'
import { campaignHeaders, providerError, threadHeaders } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

export const postmarkProvider: EmailProvider = {
  descriptor: getDescriptor('postmark')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const headers = { ...campaignHeaders(msg), ...threadHeaders(msg) }

    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': creds.serverToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        From: msg.from,
        To: msg.to.join(', '),
        Subject: msg.subject,
        HtmlBody: msg.html,
        ...(msg.text ? { TextBody: msg.text } : {}),
        // Marketing mail must go out on a broadcast stream; Postmark rejects
        // bulk sends on the default `outbound` transactional stream.
        MessageStream: creds.messageStream || 'broadcast',
        // The app rewrites hrefs and injects its own open pixel in
        // emailService.sendCampaign. Letting Postmark also rewrite links would
        // double-wrap the /api/track/click URLs and break click analytics.
        TrackLinks: 'None',
        TrackOpens: false,
        Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })),
      }),
    })

    const body: any = await response.json().catch(() => null)
    // Postmark signals application errors with a non-zero ErrorCode.
    if (!response.ok || (body?.ErrorCode && body.ErrorCode !== 0)) {
      const detail = body?.Message || response.statusText
      throw providerError('postmark', msg.to.join(', '), detail, response.status)
    }
    return { messageId: body?.MessageID || '' }
  },

  // https://postmarkapp.com/developer/webhooks/bounce-webhook
  parseWebhook(body: unknown): NormalizedBounce[] {
    const evt = body as any
    const email = evt?.Email
    if (!email) return []
    // Spam complaints come on their own webhook (RecordType SpamComplaint), or as a bounce of that type.
    if (evt.RecordType === 'SpamComplaint' || (evt.RecordType === 'Bounce' && evt.Type === 'SpamComplaint')) return [{ email, type: 'complaint' }]
    if (evt.RecordType !== 'Bounce') return []
    // HardBounce / BadEmailAddress are permanent; everything else we treat as soft.
    const hard = evt.Type === 'HardBounce' || evt.Type === 'BadEmailAddress'
    return [{ email, type: hard ? 'hard' : 'soft', reason: evt.Description || evt.Details }]
  },
}
