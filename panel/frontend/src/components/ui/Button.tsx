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
    'bg-accent text-accent-foreground hover:bg-accent-hover font-semibold shadow-[0_4px_16px_rgba(67,56,202,0.12)]',
  secondary:
    'border border-border bg-card text-foreground shadow-[0_1px_2px_rgba(24,24,27,0.04)] hover:bg-background',
  ghost: 'text-foreground hover:bg-muted',
  danger:
    'bg-destructive-soft text-destructive hover:bg-destructive-soft/80',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-10 px-4 text-sm rounded-xl',
  md: 'h-11 px-5 text-[15px] rounded-xl',
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