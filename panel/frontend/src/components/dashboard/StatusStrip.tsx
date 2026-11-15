import {
  ArrowRight,
  CloudArrowDown,
  FolderOpen,
  ShieldCheck,
} from '@phosphor-icons/react'
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
  icon,
  iconClassName,
  children,
}: {
  title: string
  href: string
  icon: ReactNode
  iconClassName: string
  children: ReactNode
}) {
  return (
    <Card className="shadow-[var(--shadow-card,0_1px_2px_rgba(24,24,27,0.04),0_8px_24px_rgba(24,24,27,0.06))]">
      <CardBody className="p-5">
        <Link
          to={href}
          className="group flex items-center gap-4 transition-colors duration-150"
        >
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
              iconClassName,
            )}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{title}</p>
              <ArrowRight
                weight="regular"
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              />
            </div>
            <div className="mt-1">{children}</div>
          </div>
        </Link>
      </CardBody>
    </Card>
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
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="System status"
      >
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index}>
            <CardBody className="p-5">
              <Skeleton className="h-14 w-full" />
            </CardBody>
          </Card>
        ))}
      </div>
    )
  }

  if (!summary) {
    return null
  }

  const { projects, backup, nearest_cert_expiry } = summary

  return (
    <section
      aria-label="System status"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <StatusTile
        title="Projects"
        href="/projects"
        icon={<FolderOpen weight="regular" className="size-6" aria-hidden />}
        iconClassName="bg-accent-soft text-accent"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-semibold">
            <span className="tabular-nums">{projects.up}</span>
            <span className="font-normal text-muted-foreground"> up</span>
            {projects.unhealthy > 0 ? (
              <>
                <span className="font-normal text-muted-foreground"> · </span>
                <span className="text-warning">{projects.unhealthy} degraded</span>
              </>
            ) : null}
          </p>
          {projectsBadge(summary)}
        </div>
      </StatusTile>
      <StatusTile
        title="Last backup"
        href="/backups"
        icon={<CloudArrowDown weight="regular" className="size-6" aria-hidden />}
        iconClassName="bg-[#ECFDF5] text-[#047857]"
      >
        {backup === null ? (
          <p className="text-lg font-semibold text-muted-foreground">Not configured</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-lg font-semibold tabular-nums">
              {formatBackupLastRun(backup.last_run)}
            </p>
            {backupBadge(summary)}
          </div>
        )}
      </StatusTile>
      <StatusTile
        title="Nearest cert expiry"
        href="/domains"
        icon={<ShieldCheck weight="regular" className="size-6" aria-hidden />}
        iconClassName="bg-muted text-muted-foreground"
      >
        {nearest_cert_expiry ? (
          <p
            className="text-lg font-semibold tabular-nums"
            title={formatDateTime(nearest_cert_expiry)}
          >
            {formatRelativeTime(nearest_cert_expiry, now)}
          </p>
        ) : (
          <p className="text-lg font-semibold text-muted-foreground">None</p>
        )}
      </StatusTile>
    </section>
  )
}