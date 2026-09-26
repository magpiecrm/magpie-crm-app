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
      'inline-flex items-center justify-center font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer'

    const variants = {
      primary:
        'bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/90',
      secondary:
        'bg-card text-foreground border border-input hover:bg-muted active:bg-muted-hover',
      outline:
        'border border-input bg-transparent text-foreground hover:bg-muted active:bg-muted-hover',
      ghost:
        'text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted-hover',
      danger:
        'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/95',
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
