import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  /** A line under the title saying what the dialog is for. */
  description?: React.ReactNode
  children?: React.ReactNode
  /** Sizes the box, e.g. `max-w-2xl`. Without a `max-w-` here it's a small form's width, never the whole screen. */
  className?: string
  headerActions?: React.ReactNode
  /** Pads and scrolls the content (a `DialogBody`). Leave off when the content brings its own `DialogBody`/`DialogFooter`. */
  padded?: boolean
  /** Buttons pinned under the content (a `DialogFooter`). A form puts its own `DialogFooter` inside the form instead. */
  footer?: React.ReactNode
  /** `alertdialog` for a question that has to be answered (confirmations). */
  role?: 'dialog' | 'alertdialog'
  /** Shown beside the title, e.g. a warning sign on a confirmation. */
  icon?: React.ReactNode
  /** Where focus goes on opening. Otherwise a field that asks for it (`autoFocus`), else the dialog itself. */
  initialFocus?: React.RefObject<HTMLElement | null>
}

/** The open pop-ups, newest last: Escape and Tab belong to the top one only. */
const layers: symbol[] = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable=true]'

/**
 * What every pop-up shares (Dialog, Sheet): it closes on Escape when it's on
 * top, keeps Tab inside itself, stops the page behind it scrolling, and gives
 * focus back to whatever opened it.
 */
export function usePopupLayer(
  isOpen: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
  initialFocus?: React.RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Who opened it, read while rendering the open: a field's `autoFocus` moves focus before any effect runs.
  const openerRef = useRef<HTMLElement | null>(null)
  // The field that took focus with `autoFocus`, kept so a re-run of the effect (React's development
  // double-run, where the cleanup hands focus back to the opener) can put it back.
  const autoFocused = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  if (isOpen && !wasOpen.current && typeof document !== 'undefined') {
    openerRef.current = document.activeElement as HTMLElement | null
    autoFocused.current = null
  }
  wasOpen.current = isOpen

  useEffect(() => {
    if (!isOpen) return
    const layer = Symbol('popup')
    layers.push(layer)
    const opener = openerRef.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    if (panelRef.current?.contains(document.activeElement)) autoFocused.current ??= document.activeElement as HTMLElement
    // After React has run any `autoFocus` inside.
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      if (initialFocus?.current) initialFocus.current.focus()
      else if (panel.contains(document.activeElement)) return
      else if (autoFocused.current && panel.contains(autoFocused.current)) autoFocused.current.focus()
      else panel.focus({ preventScroll: true })
    })

    const onKey = (e: KeyboardEvent) => {
      if (layers[layers.length - 1] !== layer) return
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    // Bubbling, not capturing: a menu inside (Select, SearchSelect) stops its own Escape so only it closes.
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      layers.splice(layers.indexOf(layer), 1)
      document.body.style.overflow = overflow
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])
}

/** Puts a pop-up at the end of <body>, above everything on the page, wherever it was opened from. */
export function PopupPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>
  return createPortal(children, document.body)
}

/** Facts about what a dialog acts on (From, To, Subject…): muted labels in one column, values beside them. */
export function MetaList({ rows, className = '' }: { rows: Array<[React.ReactNode, React.ReactNode]>; className?: string }) {
  return (
    <dl className={`grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm leading-5 ${className}`}>
      {rows.map(([label, value], i) => (
        <React.Fragment key={i}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate text-foreground">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

/** True while an element can scroll further down, so its edge can say there's more. */
export function useMoreBelow(ref: React.RefObject<HTMLElement | null>) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    if (el.firstElementChild) observer?.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [ref])
  return more
}

/** The dialog's content: padded, and scrolls when it's taller than the screen, with a shadow at its bottom edge while there's more. */
export function DialogBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const more = useMoreBelow(ref)
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
      <div className={`px-5 sm:px-6 pt-2 pb-6 ${className}`}>{children}</div>
      {/* Stays at the visible bottom edge, over the content, while there's more below. */}
      {more && (
        <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -mt-10 h-10 bg-gradient-to-t from-popover via-popover/80 to-transparent">
          <div className="absolute inset-x-0 bottom-0 h-px bg-border" />
        </div>
      )}
    </div>
  )
}

/**
 * The dialog's buttons, pinned under the content: the main action last (on the
 * right), Cancel before it. Anything else (an error, a secondary link) goes
 * first with `mr-auto`. On a phone Cancel and the main action share a row, in the same order.
 */
export function DialogFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`shrink-0 flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 dark:bg-white/[0.025] px-5 sm:px-6 pt-3.5 sm:pt-3 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] sm:pb-3 sm:flex-nowrap sm:justify-end [&>button]:min-h-11 [&>button]:grow [&>button]:basis-[calc(50%-0.25rem)] sm:[&>button]:min-h-0 sm:[&>button]:grow-0 sm:[&>button]:basis-auto [&>p]:basis-full sm:[&>p]:basis-auto ${className}`}
    >
      {children}
    </div>
  )
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  className = '',
  headerActions,
  padded = false,
  footer,
  role = 'dialog',
  icon,
  initialFocus,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  usePopupLayer(isOpen, onClose, panelRef, initialFocus)

  if (!isOpen) return null

  return (
    <PopupPortal>
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
        <div className="popup-overlay absolute inset-0 bg-black/[0.18] backdrop-blur-[1px] dark:bg-black/55" onClick={onClose} aria-hidden="true" />

        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={`popup-panel relative z-10 flex w-full max-h-[92dvh] sm:max-h-[min(88dvh,900px)] flex-col overflow-hidden bg-popover text-popover-foreground border border-border dark:border-white/10 border-b-0 sm:border-b rounded-t-2xl sm:rounded-xl shadow-[0_16px_48px_-8px_rgb(17_19_22/0.22),0_2px_6px_rgb(17_19_22/0.08)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_24px_64px_-12px_rgb(0_0_0/0.7)] outline-none ${/\bmax-w-/.test(className) ? '' : 'sm:max-w-lg'} ${className}`}
        >
          {/* On a phone it's a sheet from the bottom, with the Sheet's grab handle. */}
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden="true">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          {(title || headerActions) && (
            <div className="relative shrink-0 px-5 sm:px-6 pt-3 sm:pt-5 pb-4">
              <div className={`flex items-start gap-3 ${role === 'dialog' ? 'pr-9' : ''}`}>
                {icon && <div className="-mt-1.5 shrink-0">{icon}</div>}
                <div className="min-w-0 flex-1">
                  {typeof title === 'string' ? (
                    <h2 id={titleId} className="text-lg font-semibold leading-6 tracking-[-0.015em] text-foreground">
                      {title}
                    </h2>
                  ) : (
                    <div id={titleId}>{title}</div>
                  )}
                </div>
                {headerActions && <div className="flex shrink-0 items-center gap-2">{headerActions}</div>}
              </div>
              {/* Full width under the title: only the title shares its line with the close button. */}
              {description && (
                <div id={descriptionId} className="mt-1.5 text-sm leading-5 text-pretty text-muted-foreground">
                  {description}
                </div>
              )}
              {/* A confirmation is answered by its buttons, so it has no close button. */}
              {role === 'dialog' && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className={`touch-target absolute right-3 sm:right-4 top-2 sm:top-4 inline-flex h-8 w-8 items-center justify-center rounded-md-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer`}
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              )}
            </div>
          )}

          {padded ? <DialogBody>{children}</DialogBody> : children}
          {footer && <DialogFooter>{footer}</DialogFooter>}
        </div>
      </div>
    </PopupPortal>
  )
}
