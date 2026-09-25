import React from 'react'
import { Check } from 'lucide-react'
import { Button } from './Button'

export interface AccordionItemProps {
  id: string
  title: string
  subtitle?: React.ReactNode
  isValid?: boolean
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  triggerLabel?: string
  collapseLabel?: string
}

export function AccordionItem({
  title,
  subtitle,
  isValid = false,
  isOpen,
  onToggle,
  children,
  triggerLabel = 'Manage',
  collapseLabel = 'Collapse',
}: AccordionItemProps) {
  return (
    <div
      className={`border rounded-md-xl transition-all duration-200 ${
        isOpen
          ? 'border-accent/40 bg-card shadow-md shadow-accent/5'
          : 'border-border bg-card/65'
      }`}
    >
      <div className="p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
              isValid ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
            }`}
          >
            <Check className={`w-5 h-5 ${isValid ? 'opacity-100' : 'opacity-30'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-foreground truncate">{title}</h3>
            {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggle}
          className="shrink-0 font-semibold"
        >
          {isOpen ? collapseLabel : triggerLabel}
        </Button>
      </div>

      {isOpen && (
        <div className="px-5 pb-5 pt-1 border-t border-border/60 animate-in fade-in duration-200">
          {children}
        </div>
      )}
    </div>
  )
}

export interface AccordionProps {
  children: React.ReactNode
  className?: string
}

export function Accordion({ children, className = '' }: AccordionProps) {
  return <div className={`space-y-4 ${className}`}>{children}</div>
}
