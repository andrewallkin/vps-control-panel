import type { BackupLastRun } from '../../lib/backupsApi'
import type { DashboardSummary } from '../../lib/dashboardTypes'
import { formatDateTime } from '../../lib/format'
import { StatusBadge } from '../StatusBadge'

export interface StatusStripProps {
  summary: DashboardSummary | undefined
}

export function formatBackupLastRun(
  lastRun: BackupLastRun | null | undefined,
): string {
  if (!lastRun?.finished_at) {
    return 'Never'
  }
  return formatDateTime(lastRun.finished_at)
}

function formatCertExpiry(iso: string | null | undefined): string {
  if (!iso) {
    return 'None'
  }
  return formatDateTime(iso)
}

export function StatusStrip({ summary }: StatusStripProps) {
  if (!summary) {
    return (
      <section
        aria-label="System status"
        className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
      >
        Loading status…
      </section>
    )
  }

  const { projects, backup, nearest_cert_expiry } = summary
  const projectHealthy = projects.unhealthy === 0

  const cellClass =
    'flex min-w-0 flex-col gap-2 xl:px-6 xl:first:pl-0 xl:[&:not(:first-child)]:border-l xl:[&:not(:first-child)]:border-border'

  return (
    <section
      aria-label="System status"
      className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3 xl:gap-0"
    >
      <div className={cellClass}>
        <p className="text-xs font-medium text-muted-foreground">Projects</p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm">
            <span className="font-mono">{projects.up}</span> up /{' '}
            <span className="font-mono">{projects.unhealthy}</span> unhealthy
          </p>
          {!projectHealthy ? (
            <StatusBadge variant="warning" label="Unhealthy projects" />
          ) : (
            <StatusBadge variant="healthy" label="All projects up" />
          )}
        </div>
      </div>
      <div className={cellClass}>
        <p className="text-xs font-medium text-muted-foreground">Backup</p>
        {backup === null ? (
          <p className="text-sm text-muted-foreground">Not configured</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-sm font-mono">
              {formatBackupLastRun(backup.last_run)}
            </p>
            {backup.failed ? (
              <StatusBadge variant="critical" label="Last backup failed" />
            ) : backup.overdue ? (
              <StatusBadge variant="warning" label="Backup overdue" />
            ) : (
              <StatusBadge variant="healthy" label="Backup OK" />
            )}
          </div>
        )}
      </div>
      <div className={cellClass}>
        <p className="text-xs font-medium text-muted-foreground">
          Nearest cert expiry
        </p>
        <p className="text-sm font-mono">
          {formatCertExpiry(nearest_cert_expiry)}
        </p>
      </div>
    </section>
  )
}
