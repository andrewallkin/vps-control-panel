import { CheckCircle, Question, Warning } from '@phosphor-icons/react'
import { SSL_MODE_WARNING } from '../../lib/domainsApi'

export interface SslModeBadgeProps {
  sslMode: string | null
  sslModeError: 'permission' | null
  warning: string | null
}

function modeLabel(mode: string | null): string {
  if (mode === null) {
    return 'Unknown'
  }
  if (mode === 'strict') {
    return 'Full (strict)'
  }
  return mode
}

export function SslModeBadge({ sslMode, sslModeError, warning }: SslModeBadgeProps) {
  const permissionDenied = sslMode === null && sslModeError === 'permission'
  const strict = sslMode === 'strict'
  const unknown = sslMode === null && !permissionDenied
  const icon = permissionDenied ? (
    <Warning weight="regular" aria-hidden className="size-4 shrink-0 text-warning" />
  ) : strict ? (
    <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0 text-accent" />
  ) : unknown ? (
    <Question weight="regular" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <Warning weight="regular" aria-hidden className="size-4 shrink-0 text-warning" />
  )
  const className = permissionDenied
    ? 'text-warning'
    : strict
      ? 'text-accent'
      : unknown
        ? 'text-muted-foreground'
        : 'text-warning'

  return (
    <div className="space-y-1">
      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${className}`}>
        {icon}
        <span>
          {permissionDenied ? 'Zone Settings:Read required' : modeLabel(sslMode)}
        </span>
      </span>
      {permissionDenied ? (
        <p className="text-xs text-warning">
          Add Zone Settings:Read on the Cloudflare token, then save it in Settings.
        </p>
      ) : warning === SSL_MODE_WARNING ? (
        <p className="text-xs text-warning">{SSL_MODE_WARNING}</p>
      ) : null}
    </div>
  )
}
