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
        'h-9 w-full rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-150',
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