import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
  headerActions?: React.ReactNode
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  headerActions,
}: DialogProps) {
  // Prevent body scrolling when open
  useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [isOpen])

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm animate-in fade-in duration-150">
      {/* Backdrop overlay listener */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Dialog Shell */}
      <div
        className={`bg-background border border-border rounded-2xl w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl relative z-10 transition-all duration-200 ${className}`}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-border flex justify-between items-center bg-card shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            {typeof title === 'string' ? (
              <h3 className="text-lg sm:text-xl font-bold text-foreground truncate">{title}</h3>
            ) : (
              title
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {headerActions}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content Body */}
        {children}
      </div>
    </div>
  )
}
