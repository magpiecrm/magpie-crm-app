import webpush from 'web-push'
import { db } from './db'
import { env } from './env'

export interface PushPayload {
  title: string
  body: string
  /** Path the notification opens, e.g. `/marketing/forms/abc`. */
  url?: string
  /** Collapses repeat banners of the same kind instead of stacking them. */
  tag?: string
}

let configured = false

/**
 * Configure web-push lazily: the keys are optional, so a deployment without
 * them should degrade to "no push" rather than crash on import.
 */
function ensureConfigured(): boolean {
  if (configured) return true
  if (!env.vapid.isConfigured()) return false

  webpush.setVapidDetails(
    env.vapid.subject(),
    env.vapid.publicKey()!,
    env.vapid.privateKey()!,
  )
  configured = true
  return true
}

/**
 * Deliver a notification to every registered device.
 *
 * Subscriptions the push service reports as gone (404/410 — the user deleted
 * the home-screen app, or iOS expired it) are pruned, otherwise every future
 * send would retry them forever.
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) {
    console.warn('[Push] VAPID keys not set — skipping push')
    return
  }

  const subscriptions = db.getPushSubscriptions()
  if (subscriptions.length === 0) return

  const body = JSON.stringify(payload)

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body,
        )
      } catch (err: any) {
        const status = err?.statusCode
        if (status === 404 || status === 410) {
          console.log(`[Push] Subscription gone (${status}), pruning`)
          db.removePushSubscription(sub.endpoint)
        } else {
          console.error(`[Push] Send failed (${status ?? 'unknown'}):`, err?.body ?? err?.message ?? err)
        }
      }
    }),
  )
}
