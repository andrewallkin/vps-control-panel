import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-secondary text-[#52525B]',
  success: 'bg-[#ECFDF5] text-[#047857]',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-destructive-soft text-destructive',
  info: 'bg-info-soft text-info',
}

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-[#A1A1AA]',
  success: 'bg-[#10B981]',
  warning: 'bg-[#F59E0B]',
  danger: 'bg-[#EF4444]',
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
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold',
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