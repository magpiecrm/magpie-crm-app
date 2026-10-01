import { getDescriptor } from './descriptors'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

export const sendgridProvider: EmailProvider = {
  descriptor: getDescriptor('sendgrid')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: msg.to.map((email) => ({ email })) }],
        from: msg.fromName ? { email: msg.fromEmail, name: msg.fromName } : { email: msg.fromEmail },
        subject: msg.subject,
        // text/plain must come first.
        content: [...(msg.text ? [{ type: 'text/plain', value: msg.text }] : []), { type: 'text/html', value: msg.html }],
        headers: campaignHeaders(msg),
        // The app does its own click/open tracking; SendGrid's would rewrite
        // the /api/track/click URLs on top of ours and break the analytics.
        tracking_settings: {
          click_tracking: { enable: false },
          open_tracking: { enable: false },
        },
      }),
    })

    // Success is 202 with an empty body — parsing it as JSON would throw.
    if (!response.ok) {
      const body: any = await response.json().catch(() => null)
      const detail =
        body?.errors?.map((e: any) => e.message).join('; ') || response.statusText
      throw providerError('sendgrid', msg.to.join(', '), detail, response.status)
    }

    return { messageId: response.headers.get('x-message-id') || '' }
  },

  // https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event
  parseWebhook(body: unknown): NormalizedBounce[] {
    const events = Array.isArray(body) ? body : [body]
    const out: NormalizedBounce[] = []
    for (const evt of events as any[]) {
      if (!evt?.email) continue
      if (evt.event === 'bounce') {
        // SendGrid distinguishes a true bounce from a reputation block.
        out.push({
          email: evt.email,
          type: evt.type === 'blocked' ? 'soft' : 'hard',
          reason: evt.reason,
        })
      } else if (evt.event === 'spamreport') {
        out.push({ email: evt.email, type: 'complaint' })
      } else if (evt.event === 'dropped') {
        // Dropped before sending: for an address that bounced before (a hard
        // bounce), one that reported spam, or one unsubscribed at SendGrid.
        if (/bounced address|invalid/i.test(evt.reason ?? '')) out.push({ email: evt.email, type: 'hard', reason: evt.reason })
        else if (/spam/i.test(evt.reason ?? '')) out.push({ email: evt.email, type: 'complaint', reason: evt.reason })
        else if (!/unsubscribe/i.test(evt.reason ?? '')) out.push({ email: evt.email, type: 'soft', reason: evt.reason })
      }
      // 'deferred' is only a delay: SendGrid keeps trying, so nothing is recorded.
    }
    return out
  },
}
