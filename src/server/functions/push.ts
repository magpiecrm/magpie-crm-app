import { createServerFn } from '@tanstack/react-start'
import { APP_NAME } from '../../brand'

/** Shape the browser's `PushSubscription.toJSON()` gives us. */
interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * The VAPID public key the client needs to call `pushManager.subscribe`.
 * Public by design — it is the server's identity, not a secret.
 */
export const pushPublicKeyFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    const { env } = await import('../env')
    await requireAuth()
    return { publicKey: env.vapid.publicKey() ?? null }
  })

export const subscribePushFn = createServerFn({ method: 'POST' })
  .inputValidator((d: PushSubscriptionInput) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()

    if (!data?.endpoint || !data.keys?.p256dh || !data.keys?.auth) {
      throw new Error('Invalid push subscription')
    }

    db.addPushSubscription({ endpoint: data.endpoint, keys: data.keys })
    return { success: true }
  })

export const unsubscribePushFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { endpoint: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()

    db.removePushSubscription(data.endpoint)
    return { success: true }
  })

/** Sends a notification to every registered device, to prove the wiring works. */
export const sendTestPushFn = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    const { sendPushToAll } = await import('../push')
    await requireAuth()

    await sendPushToAll({
      title: APP_NAME,
      body: 'Test notification — push is working.',
      url: '/',
      tag: 'test',
    })
    return { success: true }
  })
