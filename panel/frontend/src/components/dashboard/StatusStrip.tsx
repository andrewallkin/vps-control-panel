import type { DashboardSummary } from '../../lib/dashboardTypes'
import { StatusBadge } from '../StatusBadge'

export interface StatusStripProps {
  summary: DashboardSummary | undefined
}

function formatCertExpiry(iso: string | null | undefined): string {
  if (!iso) {
    return 'None'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString()
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

  return (
    <section
      aria-label="System status"
      className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <p className="text-xs font-medium text-muted-foreground">Projects</p>
        <p className="mt-1 text-sm">
          <span className="font-mono">{projects.up}</span> up /{' '}
          <span className="font-mono">{projects.unhealthy}</span> unhealthy
        </p>
        {!projectHealthy ? (
          <StatusBadge variant="warning" label="Unhealthy projects" />
        ) : (
          <StatusBadge variant="healthy" label="All projects up" />
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Backup</p>
        {backup === null ? (
          <p className="mt-1 text-sm text-muted-foreground">Not configured</p>
        ) : (
          <>
            <p className="mt-1 text-sm font-mono">
              {backup.last_run
                ? new Date(backup.last_run).toLocaleString()
                : 'Never'}
            </p>
            {backup.failed ? (
              <StatusBadge variant="critical" label="Last backup failed" />
            ) : backup.overdue ? (
              <StatusBadge variant="warning" label="Backup overdue" />
            ) : (
              <StatusBadge variant="healthy" label="Backup OK" />
            )}
          </>
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Nearest cert expiry
        </p>
        <p className="mt-1 text-sm font-mono">
          {formatCertExpiry(nearest_cert_expiry)}
        </p>
      </div>
    </section>
  )
}
