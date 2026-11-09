import React from 'react'
import { Loader2 } from 'lucide-react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = '',
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      ...props
    },
    ref
  ) => {
    // Every variant has a border (see-through where it shows none), so a
    // button is the same height whatever its variant, and the same as a field.
    const baseStyle =
      'inline-flex items-center justify-center border font-medium whitespace-nowrap transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none select-none cursor-pointer'

    // A filled button faded to half would read as a grey button that works,
    // so a disabled one turns into a quiet outlined box instead.
    const variants = {
      primary:
        'border-transparent bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:border-border',
      // Raised, not inset: a lighter edge than a field's and a hairline shadow, so Cancel never reads as one more field.
      secondary:
        'bg-card text-foreground border-control shadow-[0_1px_2px_rgb(17_19_22/0.06)] hover:bg-muted active:bg-muted-hover dark:bg-white/[0.04] dark:hover:bg-white/[0.08] dark:shadow-none disabled:opacity-50',
      outline:
        'border-control bg-transparent text-foreground hover:bg-muted active:bg-muted-hover dark:hover:bg-white/[0.06] disabled:opacity-50',
      ghost:
        'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted-hover disabled:opacity-50',
      // The same deep red with white text in both themes, so a destructive action keeps its weight in dark mode.
      danger:
        'border-transparent bg-destructive text-destructive-foreground dark:bg-[#d23b30] dark:text-white hover:bg-destructive/90 dark:hover:bg-[#d23b30]/90 active:bg-destructive/95 disabled:bg-muted disabled:text-muted-foreground disabled:border-border dark:disabled:bg-muted dark:disabled:text-muted-foreground',
    }

    const sizes = {
      sm: 'px-3 py-1.5 text-xs rounded-md-xs gap-1.5',
      md: 'px-4 py-2 text-sm rounded-md-s gap-2',
      lg: 'px-5 py-2.5 text-base rounded-md-m gap-2.5',
      icon: 'p-2 rounded-md-xs touch-target',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
        {!isLoading && leftIcon && <span className="shrink-0">{leftIcon}</span>}
        {/* An icon button's icon can come as `leftIcon` or as its children. */}
        {size === 'icon' ? !isLoading && !leftIcon && children : children}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    )
  }
)

Button.displayName = 'Button'
