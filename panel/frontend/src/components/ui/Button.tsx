import { CircleNotch } from '@phosphor-icons/react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonClassOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-foreground hover:bg-accent-hover font-semibold',
  secondary:
    'bg-muted border border-border-strong text-foreground hover:bg-secondary',
  ghost: 'text-foreground hover:bg-muted',
  danger:
    'bg-destructive-soft text-destructive hover:bg-destructive hover:text-foreground',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg',
  md: 'h-9 px-4 text-sm rounded-lg',
}

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: ButtonClassOptions = {}): string {
  return cn(base, variantClasses[variant], sizeClasses[size], className)
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    disabled,
    className,
    children,
    ...props
  },
  ref,
) {
  const busy = loading || undefined
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={busy}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading ? (
        <CircleNotch weight="bold" aria-hidden className="size-4 animate-spin" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading ? rightIcon : null}
    </button>
  )
})