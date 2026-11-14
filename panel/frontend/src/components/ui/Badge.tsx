import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-secondary text-foreground',
  success: 'bg-accent-soft text-accent',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-destructive-soft text-destructive',
  info: 'bg-info-soft text-info',
}

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-accent',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  dot?: boolean
  children: ReactNode
}

export function Badge({ tone = 'neutral', dot, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className={cn('size-1.5 shrink-0 rounded-full', dotClasses[tone])} aria-hidden />
      ) : null}
      {children}
    </span>
  )
}