import { CheckCircle, Info, Warning, XCircle } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const config: Record<
  AlertTone,
  { role: 'alert' | 'status'; className: string; icon: ReactNode }
> = {
  info: {
    role: 'status',
    className: 'border-info/30 bg-info-soft text-foreground',
    icon: <Info weight="fill" aria-hidden className="size-4 shrink-0 text-info" />,
  },
  success: {
    role: 'status',
    className: 'border-accent/30 bg-accent-soft text-foreground',
    icon: <CheckCircle weight="fill" aria-hidden className="size-4 shrink-0 text-accent" />,
  },
  warning: {
    role: 'alert',
    className: 'border-warning/30 bg-warning-soft text-foreground',
    icon: <Warning weight="fill" aria-hidden className="size-4 shrink-0 text-warning" />,
  },
  danger: {
    role: 'alert',
    className: 'border-destructive/30 bg-destructive-soft text-foreground',
    icon: <XCircle weight="fill" aria-hidden className="size-4 shrink-0 text-destructive" />,
  },
}

export interface AlertProps {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function Alert({ tone = 'info', title, children, action, className }: AlertProps) {
  const entry = config[tone]
  return (
    <div
      role={entry.role}
      className={cn('flex gap-3 rounded-xl border p-3 text-sm', entry.className, className)}
    >
      {entry.icon}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}