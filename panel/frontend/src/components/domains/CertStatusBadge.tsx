import { StatusBadge } from '../StatusBadge'
import {
  certDaysLeft,
  certStatusLabel,
  certStatusVariant,
} from '../../lib/domainsApi'

export interface CertStatusBadgeProps {
  certStatus: string
  certExpiresAt: string | null
  nowMs: number
}

export function CertStatusBadge({
  certStatus,
  certExpiresAt,
  nowMs,
}: CertStatusBadgeProps) {
  const daysLeft = certDaysLeft(certExpiresAt, nowMs)
  const variant = certStatusVariant(certStatus, daysLeft)
  const label = certStatusLabel(certStatus, daysLeft)
  return <StatusBadge variant={variant} label={label} />
}
