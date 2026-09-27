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

const post = (body: unknown, secret = 'hook-secret') =>
  handlers.POST({
    request: new Request('http://acme.test/api/webhooks/email/ses', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: { provider: 'ses' },
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
