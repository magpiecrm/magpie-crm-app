import { db } from './db'
import { env } from './env'

// Cloudflare Email Service processes bounces internally (the cf-bounce MX
// records belong to its own pipeline — a custom Email Routing worker never
// sees them). Delivery failures are exposed through the GraphQL Analytics
// `emailSendingAdaptive` dataset, so we poll that and mark recipients bounced.
// Requires the API token to have zone "Analytics: Read".

interface EmailEvent {
  datetime: string
  to: string
  status: string
  errorCause: string | null
  errorDetail: string | null
  isLastEvent: boolean
}

// A hard bounce is an address that doesn't exist: 5.1.x statuses and the
// usual wording. Other 5.x.x replies (5.7.1 policy blocks, full mailboxes)
// aren't the address's fault, so they only count as a failed attempt.
const HARD_BOUNCE_PATTERNS = [
  /\b5\.1\.[0-3]\b/,
  /user unknown/i,
  /no such user/i,
  /invalid recipient/i,
  /recipient address rejected/i,
  /mailbox unavailable/i,
  /domain not found/i,
  /does not exist/i,
  /nxdomain/i,
  /unrouteable/i,
  /unroutable/i,
]

function classifyBounce(e: EmailEvent): 'hard' | 'soft' {
  const detail = `${e.errorCause || ''} ${e.errorDetail || ''}`
  return HARD_BOUNCE_PATTERNS.some((p) => p.test(detail)) ? 'hard' : 'soft'
}

/** Whether bounces come from polling Cloudflare (the active provider), not from a webhook. */
export async function pollsBounces(): Promise<boolean> {
  const { getActiveProviderConfig } = await import('./emailSettings')
  return getActiveProviderConfig().providerId === 'cloudflare'
}

/** Up to when (ISO) Cloudflare's bounces have been read, or null before the first poll. Kept across restarts. */
export function bouncesPolledUntil(): string | null {
  return db.bouncePollerSince()
}

const PAGE = 1000
const MAX_PAGES = 20

export async function pollBounces(): Promise<void> {
  // Only meaningful while Cloudflare is the active provider. Every other
  // provider pushes bounces to /api/webhooks/email/{provider} instead, and
  // polling on after a switch would keep re-applying stale Cloudflare events.
  const { getActiveProviderConfig } = await import('./emailSettings')
  const config = getActiveProviderConfig()
  if (config.providerId !== 'cloudflare') return

  const token = config.creds.apiToken || env.cloudflare.apiToken()
  const zoneId = config.creds.zoneId || env.cloudflare.zoneId()
  if (!token || !zoneId) return

  // Oldest first, a page at a time from where the last poll got to, so a busy
  // few minutes can't push events past the end of one page.
  let since: string = bouncesPolledUntil() || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  const query = `
    query ($zone: String!, $start: Time!, $end: Time!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          emailSendingAdaptive(
            limit: ${PAGE}
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_ASC]
          ) {
            datetime
            to
            status
            errorCause
            errorDetail
            isLastEvent
          }
        }
      }
    }`

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { zone: zoneId, start: since, end: now } }),
    })

    const json = await res.json() as any
    if (json.errors?.length) {
      const msg = json.errors[0].message || ''
      if (msg.includes('does not have permission')) {
        console.warn('[BouncePoller] Cloudflare API token is missing zone "Analytics: Read" permission — bounce tracking is disabled until it is added.')
        return
      }
      console.error('[BouncePoller] GraphQL error:', msg)
      return
    }

    const events: EmailEvent[] = json.data?.viewer?.zones?.[0]?.emailSendingAdaptive || []
    const failures = events.filter((e) =>
      e.isLastEvent && /fail|bounce|reject|drop/i.test(e.status || '')
    )

    // Marking a bounce twice (the page boundary overlaps by a moment) is harmless.
    for (const e of failures) {
      const type = classifyBounce(e)
      console.log(`[BouncePoller] ${type} bounce for ${e.to} (${e.status}: ${e.errorCause || e.errorDetail || 'no detail'})`)
      db.updateRecipientBounceStatus(e.to, type)
    }

    if (events.length < PAGE) {
      since = now
      break
    }
    // A full page: carry on from its last event.
    const last = events[events.length - 1].datetime
    if (last <= since) break
    since = last
  }

  db.setBouncePollerSince(since)
}
