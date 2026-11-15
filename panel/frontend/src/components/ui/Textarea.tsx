import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, mono, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-[4.5rem] w-full rounded-xl border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground transition-colors duration-150',
        invalid || props['aria-invalid']
          ? 'border-destructive'
          : 'border-border-strong focus:border-accent',
        mono && 'font-mono',
        className,
      )}
      {...props}
    />
  )
})