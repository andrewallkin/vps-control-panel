import { Badge, type BadgeTone } from '../ui'
import {
  certDaysLeft,
  certStatusLabel,
  certStatusVariant,
} from '../../lib/domainsApi'

const CERT_STATUS_FALLBACK_LABELS: Record<string, string> = {
  pending: 'Pending',
  expired: 'Expired',
  renewing: 'Renewing',
}

export interface CertStatusBadgeProps {
  certStatus: string
  certExpiresAt: string | null
  nowMs: number
}

function toneFromVariant(variant: ReturnType<typeof certStatusVariant>): BadgeTone {
  if (variant === 'healthy') {
    return 'success'
  }
  if (variant === 'warning') {
    return 'warning'
  }
  return 'danger'
}

export function CertStatusBadge({
  certStatus,
  certExpiresAt,
  nowMs,
}: CertStatusBadgeProps) {
  const daysLeft = certDaysLeft(certExpiresAt, nowMs)
  const variant = certStatusVariant(certStatus, daysLeft)
  const baseLabel = certStatusLabel(certStatus, daysLeft)
  const label =
    baseLabel === certStatus
      ? (CERT_STATUS_FALLBACK_LABELS[certStatus] ?? certStatus)
      : baseLabel
  return (
    <Badge tone={toneFromVariant(variant)} dot>
      {label}
    </Badge>
  )
}
