import { createServerFn } from '@tanstack/react-start'

export const notificationsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()

    const { db } = await import('../db')
    return {
      notifications: db.getNotifications(),
      unreadCount: db.getUnreadNotificationCount(),
    }
  })

export const markNotificationsReadFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { ids?: string[] }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()

    const { db } = await import('../db')
    db.markNotificationsRead(data.ids)
    return { success: true }
  })

// Permanently deletes notifications — all of them, or just `ids` for a
// single dismiss. Distinct from markNotificationsReadFn, which only flips
// the read flag; this is what backs the bell's "Clear all" / per-item ×.
export const clearNotificationsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { ids?: string[] }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()

    const { db } = await import('../db')
    db.clearNotifications(data.ids)
    return { success: true }
  })
