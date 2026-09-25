import { useCallback, useEffect, useState } from 'react'
import { pushPublicKeyFn, subscribePushFn, unsubscribePushFn } from '../server/functions'

/** The VAPID key travels as base64url but `subscribe()` wants a Uint8Array. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  // Backed by an explicit ArrayBuffer: `applicationServerKey` rejects the
  // SharedArrayBuffer-compatible default that `new Uint8Array(n)` now infers.
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export type PushStatus = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied'

/**
 * Web Push subscription management.
 *
 * The iOS-specific wrinkle: Safari only exposes push to web apps that have been
 * added to the Home Screen, so `needs-install` is a real state the UI has to
 * explain — otherwise the button looks broken. `subscribe()` must be called
 * straight from a user gesture or iOS rejects the permission prompt.
 */
export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>('unsupported')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!supported) {
      // On iOS this is exactly what an uninstalled Safari tab looks like, so
      // point at installing rather than declaring the device incapable.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      setStatus(isIOS ? 'needs-install' : 'unsupported')
      return
    }

    setStatus(Notification.permission as PushStatus)

    navigator.serviceWorker.getRegistration().then(async (reg) => {
      const existing = await reg?.pushManager.getSubscription()
      setSubscribed(Boolean(existing))
    }).catch(() => {})
  }, [])

  const subscribe = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { publicKey } = await pushPublicKeyFn()
      if (!publicKey) throw new Error('Push is not configured on the server (missing VAPID keys)')

      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      // Must happen in the same gesture-initiated task on iOS.
      const permission = await Notification.requestPermission()
      setStatus(permission as PushStatus)
      if (permission !== 'granted') return

      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } }
      if (!json.endpoint || !json.keys) throw new Error('Browser returned an incomplete subscription')

      await subscribePushFn({ data: { endpoint: json.endpoint, keys: json.keys } })
      setSubscribed(true)
    } catch (err: any) {
      setError(err?.message ?? 'Could not enable notifications')
    } finally {
      setBusy(false)
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await unsubscribePushFn({ data: { endpoint: subscription.endpoint } })
        await subscription.unsubscribe()
      }
      setSubscribed(false)
    } catch (err: any) {
      setError(err?.message ?? 'Could not turn off notifications')
    } finally {
      setBusy(false)
    }
  }, [])

  return { status, subscribed, busy, error, subscribe, unsubscribe }
}
