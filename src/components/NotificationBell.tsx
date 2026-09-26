import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellRing, BellOff, Loader2, Share, X } from 'lucide-react'
import { queryKeys } from '../queryKeys'
import { notificationsFn, markNotificationsReadFn, clearNotificationsFn } from '../server/functions'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { APP_NAME } from '../brand'

function timeAgo(isoDate: string) {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: () => notificationsFn(),
    refetchInterval: 15000,
  })

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0
  const push = usePushNotifications()

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleToggle = async () => {
    const nextOpen = !isOpen
    setIsOpen(nextOpen)
    if (nextOpen && unreadCount > 0) {
      await markNotificationsReadFn({ data: {} })
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() })
    }
  }

  const handleClearAll = async () => {
    setIsClearing(true)
    try {
      await clearNotificationsFn({ data: {} })
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() })
    } finally {
      setIsClearing(false)
    }
  }

  const handleDismiss = async (id: string) => {
    setDismissingId(id)
    try {
      await clearNotificationsFn({ data: { ids: [id] } })
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() })
    } finally {
      setDismissingId(null)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleToggle}
        className="relative touch-target flex items-center justify-center p-2 rounded-md-s hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-2 w-2 rounded-full bg-accent" />
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] max-h-[60dvh] overflow-y-auto bg-card border border-border rounded-md-s shadow-lg z-40">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={handleClearAll}
                disabled={isClearing}
                className="text-xs font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors cursor-pointer"
              >
                {isClearing ? 'Clearing...' : 'Clear all'}
              </button>
            )}
          </div>

          {/* Push controls. On iOS, web push only works once the app has been
              added to the Home Screen, so that case gets its own explanation. */}
          <div className="px-4 py-3 border-b border-border">
            {push.status === 'needs-install' ? (
              <p className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                <Share className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
                <span>
                  To get notifications on this phone, tap <strong className="text-foreground">Share</strong> then{' '}
                  <strong className="text-foreground">Add to Home Screen</strong>, and open {APP_NAME} from the icon.
                </span>
              </p>
            ) : push.status === 'denied' ? (
              <p className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                <BellOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Notifications are blocked. Re-enable them in your device settings — the app can't ask again.</span>
              </p>
            ) : push.status === 'unsupported' ? (
              <p className="text-xs text-muted-foreground">This browser doesn't support push notifications.</p>
            ) : push.subscribed ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground font-medium flex items-center gap-1.5">
                  <BellRing className="w-3.5 h-3.5 text-accent" />
                  Notifications on
                </span>
                <button
                  onClick={push.unsubscribe}
                  disabled={push.busy}
                  className="text-xs text-muted-foreground hover:text-destructive font-semibold disabled:opacity-50"
                >
                  Turn off
                </button>
              </div>
            ) : (
              <button
                onClick={push.subscribe}
                disabled={push.busy}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md-s text-xs font-semibold hover:bg-primary/85 active:scale-95 transition-all disabled:opacity-50"
              >
                {push.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
                Enable notifications
              </button>
            )}
            {push.error && <p className="text-[11px] text-destructive mt-2">{push.error}</p>}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No notifications yet.</div>
          ) : (
            <ul>
              {notifications.map(n => (
                <li key={n.id} className="group px-4 py-3 border-b border-border last:border-b-0 text-sm flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  <button
                    onClick={() => handleDismiss(n.id)}
                    disabled={dismissingId === n.id}
                    aria-label="Dismiss notification"
                    className="touch-target touch-reveal shrink-0 -mr-1.5 -mt-1 p-1.5 rounded-md-s text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    {dismissingId === n.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
