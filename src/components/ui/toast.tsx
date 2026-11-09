import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { PopupPortal } from './Dialog'

type Tone = 'success' | 'error' | 'info'

export interface ToastOptions {
  /** A second line with the detail: the item's name, what to do next. */
  description?: React.ReactNode
  /** One action beside the message, such as Open or Undo. */
  action?: { label: string; onClick: () => void }
  /** How long it stays, in ms. Errors stay longer, and nothing goes while the pointer is over it. */
  duration?: number
}

interface ToastItem extends ToastOptions {
  id: number
  tone: Tone
  title: React.ReactNode
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function push(tone: Tone, title: React.ReactNode, options: ToastOptions = {}) {
  if (typeof window === 'undefined') return 0
  const id = nextId++
  // Three at most: the oldest makes way.
  items = [...items, { id, tone, title, ...options }].slice(-3)
  emit()
  return id
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

/**
 * Tells someone how something went without stopping them, in place of the
 * browser's `alert()`: `toast.success('Campaign deleted')`,
 * `toast.error('Couldn't delete the campaign', { description: err.message })`.
 */
export const toast = Object.assign((title: React.ReactNode, options?: ToastOptions) => push('info', title, options), {
  success: (title: React.ReactNode, options?: ToastOptions) => push('success', title, options),
  error: (title: React.ReactNode, options?: ToastOptions) => push('error', title, options),
  info: (title: React.ReactNode, options?: ToastOptions) => push('info', title, options),
})

const TONES = {
  success: { Icon: CheckCircle2, icon: 'text-accent' },
  error: { Icon: AlertCircle, icon: 'text-destructive' },
  info: { Icon: Info, icon: 'text-accent' },
} as const

function ToastCard({ item }: { item: ToastItem }) {
  const { Icon, icon } = TONES[item.tone]
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const duration = item.duration ?? (item.tone === 'error' ? 8000 : 4500)
  const start = () => {
    timer.current = setTimeout(() => dismissToast(item.id), duration)
  }
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
  }
  useEffect(() => {
    start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      role={item.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={start}
      className="toast-in pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-border bg-popover dark:bg-[#23262b] py-3 pl-4 pr-2.5 text-popover-foreground shadow-xl dark:shadow-[0_16px_40px_-8px_rgb(0_0_0/0.8)] dark:border-white/15"
    >
      <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1 py-px">
        <p className="text-sm font-medium leading-5 text-foreground">{item.title}</p>
        {item.description && <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground text-pretty break-words">{item.description}</div>}
      </div>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action!.onClick()
            dismissToast(item.id)
          }}
          className="shrink-0 self-center rounded-md-xs border border-control bg-card dark:bg-white/[0.04] px-2.5 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss"
        className="inline-flex h-7 w-7 shrink-0 self-center items-center justify-center rounded-md-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** Where toasts show: bottom right, or along the bottom on a phone. Mounted once, in the app's layout. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => items)
  // The stack is there from the start (once on the page, so server and browser render alike):
  // a live region announces what's added to it more reliably than one that appears with its message.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return (
    <PopupPortal>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-0 sm:items-end sm:px-8 sm:pb-8"
      >
        <div className="flex w-full max-w-[420px] flex-col gap-2">
          {list.map((item) => (
            <ToastCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </PopupPortal>
  )
}
