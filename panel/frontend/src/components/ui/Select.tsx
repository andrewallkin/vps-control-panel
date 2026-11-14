import { CaretDown } from '@phosphor-icons/react'
import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'h-9 w-full appearance-none rounded-lg border bg-background pl-3 pr-9 text-sm text-foreground transition-colors duration-150',
          invalid || props['aria-invalid']
            ? 'border-destructive'
            : 'border-border-strong focus:border-accent',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <CaretDown
        weight="bold"
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
})