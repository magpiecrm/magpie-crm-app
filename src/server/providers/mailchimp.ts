import { getDescriptor } from './descriptors'
import { campaignHeaders, providerError } from './types'
import type { EmailProvider, NormalizedBounce, OutboundMessage, ProviderCredentials } from './types'

// Mailchimp Transactional, still Mandrill under the hood. Two traps worth
// knowing: the API key travels in the JSON body rather than a header, and
// application errors come back as HTTP 200 — a successful call returns a JSON
// array, a failed one returns an object.

export const mailchimpProvider: EmailProvider = {
  descriptor: getDescriptor('mailchimp')!,

  async send(msg: OutboundMessage, creds: ProviderCredentials) {
    const response = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: creds.apiKey,
        message: {
          html: msg.html,
          subject: msg.subject,
          from_email: msg.fromEmail,
          from_name: msg.fromName || undefined,
          to: msg.to.map((email) => ({ email, type: 'to' })),
          headers: campaignHeaders(msg),
          // We rewrite links and inject our own open pixel; Mandrill's tracking
          // would wrap the /api/track/click URLs and break click analytics.
          track_clicks: false,
          track_opens: false,
        },
      }),
    })

    const body: any = await response.json().catch(() => null)

    // An error is an object, not the expected array of per-recipient results.
    if (!response.ok || !Array.isArray(body)) {
      const detail = body?.message || response.statusText
      throw providerError('mailchimp', msg.to.join(', '), detail, response.status)
    }

    const rejected = body.find(
      (r: any) => r.status === 'rejected' || r.status === 'invalid',
    )
    if (rejected) {
      throw providerError(
        'mailchimp',
        rejected.email,
        `${rejected.status}: ${rejected.reject_reason || 'no reason given'}`,
      )
    }

    return { messageId: body[0]?._id || '' }
  },

  // https://mailchimp.com/developer/transactional/guides/track-respond-activity-webhooks/
  parseWebhook(body: unknown): NormalizedBounce[] {
    const events = Array.isArray(body) ? body : [body]
    const out: NormalizedBounce[] = []
    for (const evt of events as any[]) {
      const email = evt?.msg?.email
      if (!email) continue
      if (evt.event === 'hard_bounce' || evt.event === 'spam') {
        out.push({ email, type: 'hard', reason: evt.msg?.bounce_description })
      } else if (evt.event === 'soft_bounce' || evt.event === 'reject') {
        out.push({ email, type: 'soft', reason: evt.msg?.bounce_description })
      }
    }
    return out
  },
}
