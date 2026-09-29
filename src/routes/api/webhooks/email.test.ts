import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'email-webhook-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { Route } = await import('./email.$provider')
const { db } = await import('../../../server/db')
const handlers = (Route as any).options.server.handlers

const originalSecret = process.env.WEBHOOK_SECRET
afterEach(() => {
  vi.unstubAllGlobals()
  if (originalSecret === undefined) delete process.env.WEBHOOK_SECRET
  else process.env.WEBHOOK_SECRET = originalSecret
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const post = (body: unknown, secret = 'hook-secret', provider = 'ses') =>
  handlers.POST({
    request: new Request(`http://acme.test/api/webhooks/email/${provider}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: { provider },
  }) as Promise<Response>

const status = (email: string) => db.data.contacts.find((c) => c.email === email)?.status

describe('SES events', () => {
  it('unsubscribes someone who marked an email as spam, and marks a hard bounce', async () => {
    process.env.WEBHOOK_SECRET = 'hook-secret'
    db.upsertContact('angry@b.test', {}, { create: true })
    db.upsertContact('gone@b.test', {}, { create: true })

    const complaint = { eventType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'Angry@b.test' }] } }
    expect((await post(complaint)).status).toBe(200)
    expect(status('angry@b.test')).toBe('unsubscribed')

    const bounce = { eventType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'gone@b.test' }] } }
    expect((await post({ Type: 'Notification', Message: JSON.stringify(bounce) })).status).toBe(200)
    expect(status('gone@b.test')).toBe('bounced')
  })

  it('needs the webhook secret', async () => {
    process.env.WEBHOOK_SECRET = 'hook-secret'
    db.upsertContact('safe@b.test', {}, { create: true })
    const complaint = { eventType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'safe@b.test' }] } }
    expect((await post(complaint, 'wrong')).status).toBe(401)
    expect(status('safe@b.test')).not.toBe('unsubscribed')
  })

  it('confirms only a real Amazon SNS subscription link', async () => {
    process.env.WEBHOOK_SECRET = 'hook-secret'
    const fetch = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetch)
    expect((await post({ Type: 'SubscriptionConfirmation', SubscribeURL: 'http://169.254.169.254/latest/meta-data' })).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    const real = 'https://sns.eu-west-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:eu-west-2:1:t&Token=abc'
    expect((await post({ Type: 'SubscriptionConfirmation', SubscribeURL: real })).status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(real)
  })
})

describe("events from the host's mail server", () => {
  it('marks hard bounces and complaints, and skips anything malformed', async () => {
    process.env.WEBHOOK_SECRET = 'hook-secret'
    for (const email of ['gone@h.test', 'angry@h.test', 'safe@h.test']) db.upsertContact(email, {}, { create: true })
    const events = [
      { email: 'gone@h.test', type: 'hard', reason: '550 5.1.1 no such user' },
      { email: 'angry@h.test', type: 'complaint' },
      { email: 'not-an-address', type: 'hard' },
      { email: 'safe@h.test', type: 'delete-everything' },
    ]
    const res = await post({ events }, 'hook-secret', 'smtp')
    expect(await res.json()).toMatchObject({ success: true, processed: 2 })
    expect(status('gone@h.test')).toBe('bounced')
    expect(status('angry@h.test')).toBe('unsubscribed')
    expect(status('safe@h.test')).toBe('subscribed')
    expect((await post({ events }, 'wrong', 'smtp')).status).toBe(401)
  })
})

describe('webhook access', () => {
  it('is off until WEBHOOK_SECRET is set, then takes it as a bearer token or ?s=', async () => {
    delete process.env.WEBHOOK_SECRET
    db.upsertContact('open@b.test', {}, { create: true })
    const complaint = { type: 'email.complained', data: { to: ['open@b.test'] } }
    expect((await post(complaint, 'anything', 'resend')).status).toBe(503)
    expect(status('open@b.test')).toBe('subscribed')

    process.env.WEBHOOK_SECRET = 'hook-secret'
    const viaQuery = (secret: string) =>
      handlers.POST({
        request: new Request(`http://acme.test/api/webhooks/email/resend?s=${secret}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(complaint) }),
        params: { provider: 'resend' },
      }) as Promise<Response>
    expect((await viaQuery('nope')).status).toBe(401)
    expect((await viaQuery('hook-secret')).status).toBe(200)
    expect(status('open@b.test')).toBe('unsubscribed')
  })

  it('answers the address check providers make when a webhook is added', async () => {
    expect((await handlers.GET({ request: new Request('http://acme.test/api/webhooks/email/mailgun'), params: { provider: 'mailgun' } })).status).toBe(200)
    expect((await handlers.HEAD({ request: new Request('http://acme.test/api/webhooks/email/mailgun', { method: 'HEAD' }), params: { provider: 'mailgun' } })).status).toBe(200)
  })
})

describe('what a bounce or complaint does to a contact', () => {
  it('a soft bounce is only a failed attempt; a hard one stops their email, even after a re-import', async () => {
    process.env.WEBHOOK_SECRET = 'hook-secret'
    db.upsertContact('full@b.test', {}, { create: true })
    db.upsertContact('gone@r.test', {}, { create: true })
    await post({ events: [{ email: 'full@b.test', type: 'soft', reason: '452 mailbox full' }, { email: 'gone@r.test', type: 'hard' }] }, 'hook-secret', 'smtp')
    expect(status('full@b.test')).toBe('subscribed')
    expect(status('gone@r.test')).toBe('bounced')

    // Deleted and imported again: still bounced, not subscribed.
    db.data.contacts = db.data.contacts.filter((c) => c.email !== 'gone@r.test')
    db.upsertContact('gone@r.test', {}, { create: true })
    expect(status('gone@r.test')).toBe('bounced')
  })

  it('a complaint unsubscribes them for good, until they sign up again', async () => {
    process.env.WEBHOOK_SECRET = 'hook-secret'
    db.upsertContact('spam@r.test', {}, { create: true })
    await post({ type: 'email.complained', data: { to: ['spam@r.test'] } }, 'hook-secret', 'resend')
    expect(status('spam@r.test')).toBe('unsubscribed')
    expect(db.emailStop('spam@r.test')?.reason).toBe('complained')
    // Only a keyed hash is kept, never the address.
    expect(JSON.stringify(db.data.email_stops)).not.toContain('spam@r.test')

    db.data.contacts = db.data.contacts.filter((c) => c.email !== 'spam@r.test')
    db.upsertContact('spam@r.test', {}, { create: true })
    expect(status('spam@r.test')).toBe('unsubscribed')

    // Signing up again (a form) is new consent.
    db.markSignedUp('spam@r.test')
    expect(db.emailStop('spam@r.test')).toBeNull()
  })
})
