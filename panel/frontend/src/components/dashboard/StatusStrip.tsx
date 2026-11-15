import { ArrowRight } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { BackupLastRun } from '../../lib/backupsApi'
import type { DashboardSummary } from '../../lib/dashboardTypes'
import { formatDateTime, formatRelativeTime } from '../../lib/format'
import { useTickingNow } from '../../hooks/useTickingNow'
import { Badge, Card, CardBody, Skeleton } from '../ui'
import { cn } from '../../lib/cn'

export interface StatusStripProps {
  summary: DashboardSummary | undefined
  loading?: boolean
}

export function formatBackupLastRun(
  lastRun: BackupLastRun | null | undefined,
): string {
  if (!lastRun?.finished_at) {
    return 'Never'
  }
  return formatDateTime(lastRun.finished_at)
}

function StatusTile({
  title,
  href,
  children,
  className,
}: {
  title: string
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      to={href}
      className={cn(
        'group flex min-w-0 flex-col gap-2 rounded-lg border border-transparent p-3 transition-colors duration-150 hover:border-border hover:bg-muted/40',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <ArrowRight
          weight="regular"
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        />
      </div>
      {children}
    </Link>
  )
}

function projectsBadge(summary: DashboardSummary) {
  if (summary.projects.unhealthy > 0) {
    return (
      <Badge tone="warning" dot>
        {summary.projects.unhealthy} unhealthy
      </Badge>
    )
  }
  return (
    <Badge tone="success" dot>
      All up
    </Badge>
  )
}

function backupBadge(summary: DashboardSummary) {
  const backup = summary.backup
  if (!backup) {
    return null
  }
  if (backup.failed) {
    return (
      <Badge tone="danger" dot>
        Last run failed
      </Badge>
    )
  }
  if (backup.overdue) {
    return (
      <Badge tone="warning" dot>
        Overdue
      </Badge>
    )
  }
  return (
    <Badge tone="success" dot>
      On schedule
    </Badge>
  )
}

export function StatusStrip({ summary, loading }: StatusStripProps) {
  const now = useTickingNow(60_000)

  if (loading && !summary) {
    return (
      <Card>
        <CardBody>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="System status"
          >
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        </CardBody>
      </Card>
    )
  }

  if (!summary) {
    return null
  }

  const { projects, backup, nearest_cert_expiry } = summary

  return (
    <Card>
      <CardBody className="p-2 sm:p-3">
        <section
          aria-label="System status"
          className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3"
        >
          <StatusTile title="Projects" href="/projects">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-mono tabular-nums">{projects.up}</span>
                <span className="text-muted-foreground"> up</span>
              </p>
              {projectsBadge(summary)}
            </div>
          </StatusTile>
          <StatusTile title="Backup" href="/backups">
            {backup === null ? (
              <p className="text-sm text-muted-foreground">Not configured</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-mono tabular-nums">
                  {formatBackupLastRun(backup.last_run)}
                </p>
                {backupBadge(summary)}
              </div>
            )}
          </StatusTile>
          <StatusTile title="Nearest cert" href="/domains" className="sm:col-span-2 xl:col-span-1">
            {nearest_cert_expiry ? (
              <div className="space-y-1">
                <p
                  className="text-sm font-mono tabular-nums"
                  title={formatDateTime(nearest_cert_expiry)}
                >
                  {formatRelativeTime(nearest_cert_expiry, now)}
                </p>
                <p className="text-xs text-muted-foreground">Certificate expiry</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None</p>
            )}
          </StatusTile>
        </section>
      </CardBody>
    </Card>
  )
}
