import { CheckCircle, Warning, XCircle } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

export type StatusVariant = 'healthy' | 'warning' | 'critical'

const variantConfig: Record<
  StatusVariant,
  { label: string; className: string; icon: ReactNode }
> = {
  healthy: {
    label: 'Healthy',
    className: 'text-accent',
    icon: <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />,
  },
  warning: {
    label: 'Degraded',
    className: 'text-warning',
    icon: <Warning weight="regular" aria-hidden className="size-4 shrink-0" />,
  },
  critical: {
    label: 'Down',
    className: 'text-destructive',
    icon: <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />,
  },
}

export interface StatusBadgeProps {
  variant: StatusVariant
  label?: string
}

export function StatusBadge({ variant, label }: StatusBadgeProps) {
  const config = variantConfig[variant]
  const text = label ?? config.label
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${config.className}`}
    >
      {config.icon}
      <span>{text}</span>
    </span>
  )
}

export function StaleBadge() {
  return <StatusBadge variant="warning" label="Stale" />
}
