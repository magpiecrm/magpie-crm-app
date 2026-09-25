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
    const baseStyle =
      'inline-flex items-center justify-center font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50 active:scale-98 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer'

    const variants = {
      primary:
        'bg-accent text-accent-foreground shadow-sm shadow-accent/10 hover:brightness-110 dark:hover:brightness-105 active:brightness-95',
      secondary:
        'bg-secondary text-secondary-foreground hover:bg-muted active:bg-muted/80 border border-border/50',
      outline:
        'border border-border bg-transparent text-foreground hover:bg-card/80 active:bg-card shadow-sm',
      ghost:
        'text-muted-foreground hover:text-foreground hover:bg-muted/65 active:bg-muted',
      danger:
        'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/95 shadow-sm',
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
        {size !== 'icon' && children}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    )
  }
)

Button.displayName = 'Button'
