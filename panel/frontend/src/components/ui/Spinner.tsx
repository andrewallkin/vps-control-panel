import { CircleNotch } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'

export interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <CircleNotch
      weight="bold"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn('size-4 animate-spin text-muted-foreground', className)}
    />
  )
}