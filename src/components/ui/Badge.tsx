interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  const variants = {
    default: 'bg-foreground/[0.07] text-foreground/80',
    success: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
    error: 'bg-destructive/10 text-destructive',
    info: 'bg-accent/10 text-accent',
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${variants[variant]}`}>
      {children}
    </span>
  )
}
