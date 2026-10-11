import { CheckCircle, Warning } from '@phosphor-icons/react'
import type { UploadCompleteInfo } from '../../lib/setupApi'
import { formatBytes } from '../../lib/format'

export interface UploadInfoPanelProps {
  info: UploadCompleteInfo
}

export function UploadInfoPanel({ info }: UploadInfoPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Dump summary</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {info.filename} · {formatBytes(info.size)} · {info.kind}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-medium ${
            info.header_ok ? 'text-accent' : 'text-warning'
          }`}
        >
          {info.header_ok ? (
            <CheckCircle weight="regular" aria-hidden className="size-4" />
          ) : (
            <Warning weight="regular" aria-hidden className="size-4" />
          )}
          {info.header_ok ? 'Header OK' : 'Header not recognized'}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Databases found
          </h4>
          {info.databases.length === 0 ? (
            <p className="mt-1 text-sm">None detected</p>
          ) : (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {info.databases.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Roles found
          </h4>
          {info.roles.length === 0 ? (
            <p className="mt-1 text-sm">None detected</p>
          ) : (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {info.roles.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
