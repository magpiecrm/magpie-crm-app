import { createHash, timingSafeEqual } from 'crypto'
import { env } from './env'

// The bounce and complaint webhooks (api/webhooks/*) mark people bounced or
// unsubscribed, so they only run with WEBHOOK_SECRET set, and only for a
// request carrying it: as a bearer token, or `?s=` for providers that can't
// send headers. Compared in constant time.

const digest = (s: string) => createHash('sha256').update(s).digest()

export type WebhookAuth = 'ok' | 'unset' | 'denied'

export function webhookAuth(request: Request, { allowQuery = true } = {}): WebhookAuth {
  const secret = env.webhookSecret()
  if (!secret) return 'unset'
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]
  const given = bearer ?? (allowQuery ? new URL(request.url).searchParams.get('s') : null)
  return given && timingSafeEqual(digest(given), digest(secret)) ? 'ok' : 'denied'
}

/** The response for a request that isn't let in, or null to carry on. */
export function webhookRefusal(auth: WebhookAuth, what: string): Response | null {
  if (auth === 'ok') return null
  if (auth === 'unset') {
    console.warn(`[WEBHOOK] ${what} refused: WEBHOOK_SECRET isn't set, so webhooks are off`)
    return Response.json({ error: 'Webhooks are off: set WEBHOOK_SECRET on this server, and add it to the webhook address as ?s=' }, { status: 503 })
  }
  console.warn(`[WEBHOOK] Unauthorized ${what}`)
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
