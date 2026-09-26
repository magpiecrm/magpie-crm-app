/*
 * Push-only service worker.
 *
 * Deliberately does no caching: this is a server-rendered app, and a
 * half-correct offline cache would serve stale campaign/contact data. The sole
 * job here is to receive Web Push — which on iOS only works when the app has
 * been added to the Home Screen.
 */

// Take over immediately so the first subscribe doesn't need a reload.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A malformed or plain-text payload should still surface something.
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'MagpieCRM'
  const options = {
    body: payload.body || '',
    icon: '/logo192.png',
    badge: '/logo192.png',
    // Same tag collapses repeats of one event type instead of stacking banners.
    tag: payload.tag || 'notification',
    data: { url: payload.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an already-open window rather than spawning another copy.
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
