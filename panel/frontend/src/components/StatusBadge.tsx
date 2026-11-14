import { Badge, type BadgeTone } from './ui/Badge'

export type StatusVariant = 'healthy' | 'warning' | 'critical'

const variantConfig: Record<
  StatusVariant,
  { label: string; tone: BadgeTone }
> = {
  healthy: { label: 'Healthy', tone: 'success' },
  warning: { label: 'Degraded', tone: 'warning' },
  critical: { label: 'Down', tone: 'danger' },
}

export interface StatusBadgeProps {
  variant: StatusVariant
  label?: string
}

export function StatusBadge({ variant, label }: StatusBadgeProps) {
  const config = variantConfig[variant]
  const text = label ?? config.label
  return (
    <Badge tone={config.tone} dot>
      {text}
    </Badge>
  )
}

export function StaleBadge() {
  return <StatusBadge variant="warning" label="Stale" />
}