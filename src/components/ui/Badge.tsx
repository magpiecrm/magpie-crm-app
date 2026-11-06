import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
  /** A status rather than a label: success, warning and error get their icon, so the state doesn't rest on colour. */
  status?: boolean
}

const STATUS_ICON = { success: CheckCircle2, warning: AlertTriangle, error: AlertCircle } as const

export function Badge({ children, variant = 'default', status = false }: BadgeProps) {
  const variants = {
    default: 'bg-foreground/[0.07] text-foreground/80',
    success: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
    error: 'bg-destructive/10 text-destructive',
    info: 'bg-accent/10 text-accent',
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${variants[variant]}`}>
      {status && variant in STATUS_ICON && (() => {
        const Icon = STATUS_ICON[variant as keyof typeof STATUS_ICON]
        return <Icon className="-ml-0.5 h-3 w-3 shrink-0" aria-hidden />
      })()}
      {children}
    </span>
  )
}
