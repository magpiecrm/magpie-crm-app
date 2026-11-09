import React, { useRef } from 'react'
import { X } from 'lucide-react'
import { PopupPortal, usePopupLayer } from './Dialog'

export interface SheetProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  /** Which edge the sheet slides in from. Bottom is the mobile default. */
  side?: 'bottom' | 'left' | 'right'
  /** Extra classes for the panel (e.g. a taller `max-h-[85dvh]`). */
  className?: string
  /** Pinned below the scrolling body — use for a primary action. */
  footer?: React.ReactNode
  /** A side sheet wide enough to read in (an email conversation), full width on a phone. */
  wide?: boolean
}

const SIDE_CLASSES: Record<NonNullable<SheetProps['side']>, string> = {
  bottom: 'inset-x-0 bottom-0 w-full max-h-[85dvh] rounded-t-2xl border-t popup-sheet-bottom',
  left: 'inset-y-0 left-0 h-full border-r popup-sheet-left',
  right: 'inset-y-0 right-0 h-full border-l popup-sheet-right',
}

const sideWidth = (side: NonNullable<SheetProps['side']>, wide: boolean) => (side === 'bottom' ? '' : wide ? 'w-full sm:w-[min(42rem,92vw)]' : 'w-[min(22rem,90vw)]')

/**
 * Mobile counterpart to `Dialog`: a slide-in panel for content that is an
 * inline side rail on desktop (filter forms, block editors, settings).
 * Shares Dialog's Escape, focus and scroll handling (`usePopupLayer`).
 */
export function Sheet({
  isOpen,
  onClose,
  title,
  children,
  side = 'bottom',
  className = '',
  footer,
  wide = false,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  usePopupLayer(isOpen, onClose, panelRef)

  if (!isOpen) return null

  return (
    <PopupPortal>
    <div className="fixed inset-0 z-[60]">
      <div className="popup-overlay absolute inset-0 bg-black/[0.18] backdrop-blur-[1px] dark:bg-black/55" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`absolute bg-popover text-popover-foreground border-border dark:border-white/10 flex flex-col shadow-xl outline-none ${SIDE_CLASSES[side]} ${sideWidth(side, wide)} ${className}`}
      >
        {side === 'bottom' && (
          <div className="pt-2 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
        )}

        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            {typeof title === 'string' ? (
              <h2 className="text-lg font-semibold leading-6 tracking-[-0.015em] text-foreground truncate">{title}</h2>
            ) : (
              title
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="touch-target -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-border bg-muted/40 dark:bg-white/[0.025] shrink-0 safe-b">{footer}</div>
        )}
      </div>
    </div>
    </PopupPortal>
  )
}
