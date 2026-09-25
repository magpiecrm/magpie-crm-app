import { ChevronDown } from 'lucide-react'

interface FilterAccordionProps {
  label: string
  icon: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  badgeCount?: number
  isBeta?: boolean
}

export function FilterAccordion({ label, icon, isOpen, onToggle, children, badgeCount, isBeta }: FilterAccordionProps) {
  return (
    <div className="border-b border-border/50 py-2.5 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-xs font-medium text-foreground/80 hover:text-foreground transition-colors group py-1"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground group-hover:text-accent transition-colors shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
          {isBeta && (
            <span className="text-[8px] bg-accent/10 text-accent border border-accent/20 px-1 py-0.5 rounded font-bold uppercase tracking-wider scale-90">
              Coming Soon
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {badgeCount ? (
            <span className="text-[9px] bg-accent text-accent-foreground font-bold px-1.5 py-0.5 rounded-full">
              {badgeCount}
            </span>
          ) : null}
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {isOpen && (
        <div className="mt-2.5 pl-6 pr-1 animate-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  )
}
