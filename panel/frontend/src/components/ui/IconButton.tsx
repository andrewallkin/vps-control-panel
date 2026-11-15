import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', className, children, ...props },
  ref,
) {
  const sizeClass = size === 'sm' ? 'size-10' : 'size-11'
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded-xl text-foreground transition-colors duration-150 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        sizeClass,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})