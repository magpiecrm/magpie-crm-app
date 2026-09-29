import { afterEach, describe, expect, it, vi } from 'vitest'
import { brevoProvider } from './brevo'
import { cloudflareProvider } from './cloudflare'
import { mailchimpProvider } from './mailchimp'
import { mailgunProvider } from './mailgun'
import { postmarkProvider } from './postmark'
import { resendProvider } from './resend'
import { sendgridProvider } from './sendgrid'
import { isSnsUrl, parseMessageTags, sesProvider } from './ses'
import { isUnknownRecipient } from './types'
import type { OutboundMessage } from './types'

const msg: OutboundMessage = {
  from: '"Acme" <hi@acme.com>',
  fromEmail: 'hi@acme.com',
  fromName: 'Acme',
  to: ['lead@example.com'],
  subject: 'Hello',
  html: '<p>Hi</p>',
  campaignId: 42,
}

function mockFetch(response: Partial<Response> & { jsonValue?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
    headers: response.headers ?? new Headers(),
    json: async () => response.jsonValue,
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('cloudflare', () => {
  it('posts one request per recipient with the campaign header', async () => {
    const fetchMock = mockFetch({ jsonValue: { success: true, result: { message_id: 'cf-1' } } })

    const result = await cloudflareProvider.send(
      { ...msg, to: ['a@example.com', 'b@example.com'] },
      { accountId: 'acct', apiToken: 'tok' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send')
    expect((init.headers as any).Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body).headers['X-Campaign-ID']).toBe('42')
    expect(result.messageId).toBe('cf-1')
  })

  it('throws when the API reports success: false despite a 200', async () => {
    mockFetch({ jsonValue: { success: false, errors: [{ message: 'bad token' }] } })
    await expect(
      cloudflareProvider.send(msg, { accountId: 'a', apiToken: 't' }),
    ).rejects.toThrow(/bad token/)
  })
})

describe('sendgrid', () => {
  it('reads the message id from the header, since 202 has an empty body', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 202,
      headers: new Headers({ 'x-message-id': 'sg-99' }),
      // Deliberately no json value — calling .json() on a 202 would throw.
      jsonValue: undefined,
    })

    const result = await sendgridProvider.send(msg, { apiKey: 'k' })
    expect(result.messageId).toBe('sg-99')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // The app rewrites links itself; provider tracking would double-wrap them.
    expect(body.tracking_settings.click_tracking.enable).toBe(false)
    expect(body.tracking_settings.open_tracking.enable).toBe(false)
  })

  it('surfaces the error array on failure', async () => {
    mockFetch({ ok: false, status: 401, jsonValue: { errors: [{ message: 'unauthorized' }] } })
    await expect(sendgridProvider.send(msg, { apiKey: 'k' })).rejects.toThrow(/unauthorized/)
  })
})

describe('mailchimp', () => {
  it('treats an HTTP 200 error object as a failure', async () => {
    // Mandrill returns 200 for errors; success is an array, an error is an object.
    mockFetch({ ok: true, status: 200, jsonValue: { status: 'error', message: 'Invalid API key' } })
    await expect(mailchimpProvider.send(msg, { apiKey: 'k' })).rejects.toThrow(/Invalid API key/)
  })

  it('treats a rejected recipient as a failure', async () => {
    mockFetch({
      jsonValue: [{ email: 'lead@example.com', status: 'rejected', reject_reason: 'hard-bounce' }],
    })
    await expect(mailchimpProvider.send(msg, { apiKey: 'k' })).rejects.toThrow(/hard-bounce/)
  })

  it('returns the id on success', async () => {
    mockFetch({ jsonValue: [{ email: 'lead@example.com', status: 'sent', _id: 'mc-1' }] })
    const result = await mailchimpProvider.send(msg, { apiKey: 'k' })
    expect(result.messageId).toBe('mc-1')
  })
})

describe('mailgun', () => {
  it('uses basic auth, form encoding and the EU host when region is eu', async () => {
    const fetchMock = mockFetch({ jsonValue: { id: 'mg-1' } })

    await mailgunProvider.send(msg, { apiKey: 'key-123', domain: 'mg.acme.com', region: 'eu' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.eu.mailgun.net/v3/mg.acme.com/messages')
    expect((init.headers as any).Authorization).toBe(
      `Basic ${Buffer.from('api:key-123').toString('base64')}`,
    )

    const params = init.body as URLSearchParams
    expect(params.get('h:X-Campaign-ID')).toBe('42')
    expect(params.get('o:tracking-clicks')).toBe('no')
  })

  it('defaults to the US host', async () => {
    const fetchMock = mockFetch({ jsonValue: { id: 'mg-2' } })
    await mailgunProvider.send(msg, { apiKey: 'k', domain: 'd.com', region: 'us' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mailgun.net/v3/d.com/messages')
  })
})

describe('postmark', () => {
  it('sends on the broadcast stream with link tracking off', async () => {
    const fetchMock = mockFetch({ jsonValue: { MessageID: 'pm-1', ErrorCode: 0 } })

    await postmarkProvider.send(msg, { serverToken: 'tok', messageStream: 'broadcast' })

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as any)['X-Postmark-Server-Token']).toBe('tok')
    const body = JSON.parse(init.body)
    expect(body.MessageStream).toBe('broadcast')
    expect(body.TrackLinks).toBe('None')
    expect(body.Headers).toEqual([{ Name: 'X-Campaign-ID', Value: '42' }])
  })

  it('throws on a non-zero ErrorCode even with a 200', async () => {
    mockFetch({ ok: true, jsonValue: { ErrorCode: 406, Message: 'Inactive recipient' } })
    await expect(
      postmarkProvider.send(msg, { serverToken: 't', messageStream: 'broadcast' }),
    ).rejects.toThrow(/Inactive recipient/)
  })
})

describe('brevo and resend', () => {
  it('brevo splits the sender into name and email', async () => {
    const fetchMock = mockFetch({ jsonValue: { messageId: 'bv-1' } })
    await brevoProvider.send(msg, { apiKey: 'k' })

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as any)['api-key']).toBe('k')
    const body = JSON.parse(init.body)
    expect(body.sender).toEqual({ name: 'Acme', email: 'hi@acme.com' })
    expect(body.to).toEqual([{ email: 'lead@example.com' }])
  })

  it('resend uses a bearer token and the raw from header', async () => {
    const fetchMock = mockFetch({ jsonValue: { id: 'rs-1' } })
    const result = await resendProvider.send(msg, { apiKey: 'k' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as any).Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body).from).toBe('"Acme" <hi@acme.com>')
    expect(result.messageId).toBe('rs-1')
  })
})

describe('retry classification', () => {
  it('marks provider 5xx and 429 retryable, but not 4xx', async () => {
    mockFetch({ ok: false, status: 500, jsonValue: { message: 'boom' } })
    await expect(resendProvider.send(msg, { apiKey: 'k' })).rejects.toMatchObject({
      retryable: true,
    })

    mockFetch({ ok: false, status: 429, jsonValue: { message: 'slow down' } })
    await expect(resendProvider.send(msg, { apiKey: 'k' })).rejects.toMatchObject({
      retryable: true,
    })

    // A rejected address must NOT be retried — it is a real bounce.
    mockFetch({ ok: false, status: 422, jsonValue: { message: 'domain not verified' } })
    await expect(resendProvider.send(msg, { apiKey: 'k' })).rejects.toMatchObject({
      retryable: false,
    })
  })
})

describe('webhook normalizers', () => {
  it('classifies a permanent resend bounce as hard', () => {
    const out = resendProvider.parseWebhook!({
      type: 'email.bounced',
      data: { to: ['a@b.com'], bounce: { type: 'Permanent', message: 'no such user' } },
    })
    expect(out).toEqual([{ email: 'a@b.com', type: 'hard', reason: 'no such user' }])
  })

  it('ignores unrelated events', () => {
    expect(resendProvider.parseWebhook!({ type: 'email.delivered' })).toEqual([])
    expect(sendgridProvider.parseWebhook!([{ event: 'open', email: 'a@b.com' }])).toEqual([])
  })

  it('treats a sendgrid block as soft and a bounce as hard', () => {
    const out = sendgridProvider.parseWebhook!([
      { event: 'bounce', email: 'hard@b.com', type: 'bounce' },
      { event: 'bounce', email: 'soft@b.com', type: 'blocked' },
    ])
    expect(out.map((b) => b.type)).toEqual(['hard', 'soft'])
  })

  it('reads mailgun severity out of the event-data envelope', () => {
    const out = mailgunProvider.parseWebhook!({
      'event-data': {
        event: 'failed',
        severity: 'permanent',
        recipient: 'a@b.com',
        'delivery-status': { message: 'mailbox unavailable' },
      },
    })
    expect(out).toEqual([
      { email: 'a@b.com', type: 'hard', reason: 'mailbox unavailable' },
    ])
  })
})

describe('bounces and spam complaints from every provider', () => {
  it('resend: complaints, and a temporary bounce as soft', () => {
    expect(resendProvider.parseWebhook!({ type: 'email.complained', data: { to: ['a@b.com'] } })).toEqual([{ email: 'a@b.com', type: 'complaint' }])
    expect(resendProvider.parseWebhook!({ type: 'email.bounced', data: { to: ['a@b.com'], bounce: { type: 'Transient' } } })[0].type).toBe('soft')
  })

  it('postmark: hard and soft bounces, and complaints either way they arrive', () => {
    expect(postmarkProvider.parseWebhook!({ RecordType: 'Bounce', Type: 'HardBounce', Email: 'a@b.com' })[0].type).toBe('hard')
    expect(postmarkProvider.parseWebhook!({ RecordType: 'Bounce', Type: 'SoftBounce', Email: 'a@b.com' })[0].type).toBe('soft')
    expect(postmarkProvider.parseWebhook!({ RecordType: 'SpamComplaint', Email: 'a@b.com' })).toEqual([{ email: 'a@b.com', type: 'complaint' }])
    expect(postmarkProvider.parseWebhook!({ RecordType: 'Bounce', Type: 'SpamComplaint', Email: 'a@b.com' })[0].type).toBe('complaint')
    expect(postmarkProvider.parseWebhook!({ RecordType: 'Delivery', Email: 'a@b.com' })).toEqual([])
  })

  it('sendgrid: complaints; a delay is nothing; dropped depends why', () => {
    const out = sendgridProvider.parseWebhook!([
      { event: 'spamreport', email: 'spam@b.com' },
      { event: 'deferred', email: 'slow@b.com', reason: 'try later' },
      { event: 'dropped', email: 'gone@b.com', reason: 'Bounced Address' },
      { event: 'dropped', email: 'reported@b.com', reason: 'Spam Reporting Address' },
      { event: 'dropped', email: 'left@b.com', reason: 'Unsubscribed Address' },
    ])
    expect(out.map((b) => [b.email, b.type])).toEqual([
      ['spam@b.com', 'complaint'],
      ['gone@b.com', 'hard'],
      ['reported@b.com', 'complaint'],
    ])
  })

  it('mailgun: complaints, and a temporary failure as soft', () => {
    expect(mailgunProvider.parseWebhook!({ 'event-data': { event: 'complained', recipient: 'a@b.com' } })).toEqual([{ email: 'a@b.com', type: 'complaint' }])
    expect(mailgunProvider.parseWebhook!({ 'event-data': { event: 'failed', severity: 'temporary', recipient: 'a@b.com' } })[0].type).toBe('soft')
  })

  it('brevo: hard, soft, invalid and complaints', () => {
    const one = (event: string) => brevoProvider.parseWebhook!({ event, email: 'a@b.com' })[0]?.type
    expect([one('hard_bounce'), one('invalid_email'), one('soft_bounce'), one('blocked'), one('spam'), one('delivered')]).toEqual(['hard', 'hard', 'soft', 'soft', 'complaint', undefined])
  })

  it('mandrill: spam is a complaint, not a bounce', () => {
    const out = mailchimpProvider.parseWebhook!([
      { event: 'spam', msg: { email: 'spam@b.com' } },
      { event: 'hard_bounce', msg: { email: 'gone@b.com' } },
      { event: 'soft_bounce', msg: { email: 'full@b.com' } },
    ])
    expect(out.map((b) => b.type)).toEqual(['complaint', 'hard', 'soft'])
  })
})

describe('a send refused because the address doesn\'t exist', () => {
  it('is a hard bounce; anything else refused is only a failed attempt', () => {
    expect(isUnknownRecipient({ responseCode: 550, response: '550 5.1.1 <a@b.com>: Recipient address rejected: User unknown' })).toBe(true)
    expect(isUnknownRecipient({ responseCode: 550, response: '550 No such user here' })).toBe(true)
    expect(isUnknownRecipient({ responseCode: 550, response: '550 5.7.1 Message rejected due to local policy' })).toBe(false)
    expect(isUnknownRecipient({ responseCode: 552, response: '552 5.2.2 Mailbox full' })).toBe(false)
    expect(isUnknownRecipient({ responseCode: 451, response: '451 4.1.1 try again later' })).toBe(false)
    expect(isUnknownRecipient(new Error('resend email sending failed for a@b.com: invalid recipient'))).toBe(true)
    expect(isUnknownRecipient(new Error('Rate limit exceeded'))).toBe(false)
  })
})

describe('one-click unsubscribe', () => {
  const withLink = { ...msg, unsubscribeUrl: 'https://app.test/api/unsubscribe?t=abc' }
  const expected = { 'List-Unsubscribe': '<https://app.test/api/unsubscribe?t=abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }

  it('sends List-Unsubscribe headers through SES and Mailgun when the email has an unsubscribe link', async () => {
    const ses = mockFetch({ ok: true, jsonValue: { MessageId: 'm1' } })
    await sesProvider.send(withLink, { region: 'eu-west-2', accessKeyId: 'AKIA', secretAccessKey: 's' })
    const headers = JSON.parse(ses.mock.calls[0][1].body).Content.Simple.Headers
    expect(headers).toEqual(expect.arrayContaining(Object.entries(expected).map(([Name, Value]) => ({ Name, Value }))))

    const mg = mockFetch({ jsonValue: { id: 'mg-1' } })
    await mailgunProvider.send(withLink, { apiKey: 'k', domain: 'd.com' })
    const params = mg.mock.calls[0][1].body as URLSearchParams
    expect(params.get('h:List-Unsubscribe')).toBe(expected['List-Unsubscribe'])
    expect(params.get('h:List-Unsubscribe-Post')).toBe(expected['List-Unsubscribe-Post'])
  })

  it('leaves them off without one', async () => {
    const ses = mockFetch({ ok: true, jsonValue: { MessageId: 'm1' } })
    await sesProvider.send(msg, { region: 'eu-west-2', accessKeyId: 'AKIA', secretAccessKey: 's' })
    expect(JSON.stringify(JSON.parse(ses.mock.calls[0][1].body))).not.toContain('List-Unsubscribe')
  })
})

describe('Amazon SES', () => {
  it('tags each email with SES_MESSAGE_TAGS, skipping anything SES would refuse', async () => {
    const fetch = mockFetch({ ok: true, jsonValue: { MessageId: 'm1' } })
    await sesProvider.send(msg, { region: 'eu-west-2', accessKeyId: 'AKIA', secretAccessKey: 's', configurationSet: 'magpie', messageTags: 'workspace=acme, bad tag=x' })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.ConfigurationSetName).toBe('magpie')
    expect(body.EmailTags).toEqual([{ Name: 'workspace', Value: 'acme' }])
    expect(parseMessageTags(undefined)).toEqual([])
  })

  it('reads bounces and spam complaints from SES events, directly or inside an SNS envelope', () => {
    const bounce = { eventType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'gone@b.com', diagnosticCode: '550 no such user' }] } }
    const complaint = { eventType: 'Complaint', complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'angry@b.com' }] } }
    expect(sesProvider.parseWebhook!(bounce)).toEqual([{ email: 'gone@b.com', type: 'hard', reason: '550 no such user' }])
    expect(sesProvider.parseWebhook!({ Type: 'Notification', Message: JSON.stringify(complaint) })).toEqual([
      { email: 'angry@b.com', type: 'complaint', reason: 'abuse' },
    ])
    expect(sesProvider.parseWebhook!({ eventType: 'Delivery' })).toEqual([])
  })

  it('only trusts subscription confirmation links on Amazon SNS', () => {
    expect(isSnsUrl('https://sns.eu-west-2.amazonaws.com/?Action=ConfirmSubscription&Token=x')).toBe(true)
    for (const bad of ['http://sns.eu-west-2.amazonaws.com/', 'https://sns.eu-west-2.amazonaws.com.evil.test/', 'https://169.254.169.254/latest', 'not a url']) {
      expect(isSnsUrl(bad)).toBe(false)
    }
  })
})
