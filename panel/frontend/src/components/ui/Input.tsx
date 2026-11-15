import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, mono, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-xl border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground transition-colors duration-150',
        invalid || props['aria-invalid']
          ? 'border-destructive'
          : 'border-border-strong focus:border-accent',
        mono && 'font-mono tabular',
        className,
      )}
      {...props}
    />
  )
})