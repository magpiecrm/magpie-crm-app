import React, { useEffect } from 'react'
import { X } from 'lucide-react'

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
}

const SIDE_CLASSES: Record<NonNullable<SheetProps['side']>, string> = {
  bottom: 'inset-x-0 bottom-0 w-full max-h-[85dvh] rounded-t-2xl border-t animate-in slide-in-from-bottom',
  left: 'inset-y-0 left-0 h-full w-[min(22rem,90vw)] border-r animate-in slide-in-from-left',
  right: 'inset-y-0 right-0 h-full w-[min(22rem,90vw)] border-l animate-in slide-in-from-right',
}

/**
 * Mobile counterpart to `Dialog`: a slide-in panel for content that is an
 * inline side rail on desktop (filter forms, block editors, settings).
 * Shares Dialog's body-scroll lock and Escape handling.
 */
export function Sheet({
  isOpen,
  onClose,
  title,
  children,
  side = 'bottom',
  className = '',
  footer,
}: SheetProps) {
  useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-60">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />

      <div
        className={`absolute bg-background border-border flex flex-col shadow-2xl duration-200 ${SIDE_CLASSES[side]} ${className}`}
      >
        {side === 'bottom' && (
          <div className="pt-2 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
        )}

        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            {typeof title === 'string' ? (
              <h3 className="text-base font-bold text-foreground truncate">{title}</h3>
            ) : (
              title
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="touch-target flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground rounded-md-s hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">{children}</div>

        {footer && (
          <div className="px-4 py-3 border-t border-border bg-card shrink-0 safe-b">{footer}</div>
        )}
      </div>
    </div>
  )
}
