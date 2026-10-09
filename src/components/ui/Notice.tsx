import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

const LEVELS = {
  info: { box: 'border-accent/20 bg-accent/5', icon: 'text-accent', Icon: Info },
  success: { box: 'border-emerald-500/25 bg-emerald-500/5', icon: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  warning: { box: 'border-amber-500/30 bg-amber-500/5', icon: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle },
  error: { box: 'border-destructive/30 bg-destructive/5', icon: 'text-destructive', Icon: AlertCircle },
} as const

/** A message set apart from the form around it: something to know, something done, or something wrong. */
export function Notice({
  level = 'info',
  title,
  children,
  action,
  className = '',
}: {
  level?: keyof typeof LEVELS
  title?: ReactNode
  children?: ReactNode
  /** A button or link at the right-hand end. */
  action?: ReactNode
  className?: string
}) {
  const { box, icon, Icon } = LEVELS[level]
  return (
    <div role={level === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-md-s border px-3 py-2.5 text-xs leading-relaxed text-foreground ${box} ${className}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'text-muted-foreground' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
