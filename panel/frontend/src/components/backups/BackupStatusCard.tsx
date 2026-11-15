import { CheckCircle, Clock, Warning, XCircle } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { StatusBadge } from '../StatusBadge'
import { Badge, Card, CardBody, Skeleton } from '../ui'
import { formatBytes, formatDateTime } from '../../lib/format'
import type { BackupStatus } from '../../lib/backupsApi'

function ResultStatus({ success, error }: { success?: boolean; error?: string | null }) {
  if (success === true) {
    return (
      <Badge tone="success">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        Success
      </Badge>
    )
  }
  if (success === false || error) {
    return (
      <Badge tone="danger">
        <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        Failed
      </Badge>
    )
  }
  return <span className="text-sm text-muted-foreground">—</span>
}

function ArchiveStatus({
  archiveObject,
  skippedReason,
  archiveError,
}: {
  archiveObject?: string | null
  skippedReason?: string | null
  archiveError?: string | null
}) {
  if (archiveError) {
    return (
      <Badge tone="danger">
        <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        {archiveError}
      </Badge>
    )
  }
  if (archiveObject) {
    return (
      <Badge tone="success">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        <span className="font-mono text-xs">{archiveObject}</span>
      </Badge>
    )
  }
  if (skippedReason) {
    return (
      <Badge tone="warning">
        <Warning weight="regular" aria-hidden className="size-4 shrink-0" />
        {skippedReason}
      </Badge>
    )
  }
  return <span className="text-sm text-muted-foreground">—</span>
}

export interface BackupStatusCardProps {
  status: BackupStatus | undefined
  loading?: boolean
  actions?: ReactNode
}

export function BackupStatusCard({ status, loading, actions }: BackupStatusCardProps) {
  const lastRun = status?.last_run ?? null
  const failed = lastRun?.success === false || Boolean(lastRun?.error)

  return (
    <Card aria-labelledby="backup-status-heading">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="backup-status-heading" className="text-sm font-semibold">
              Backup status
            </h2>
            {status?.overdue ? <StatusBadge variant="warning" label="Overdue" /> : null}
            {failed ? <StatusBadge variant="critical" label="Last run failed" /> : null}
          </div>
          {actions}
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
            <span className="sr-only">Loading status…</span>
          </div>
        ) : (
          <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Last run</dt>
              <dd className="mt-0.5 font-medium">
                {lastRun?.finished_at ? formatDateTime(lastRun.finished_at) : 'Never'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Result</dt>
              <dd className="mt-0.5">
                <ResultStatus success={lastRun?.success} error={lastRun?.error} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Object</dt>
              <dd className="mt-0.5 font-mono text-xs break-all">{lastRun?.object ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Size</dt>
              <dd className="mt-0.5">
                {lastRun?.size_bytes != null ? formatBytes(lastRun.size_bytes) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Archive</dt>
              <dd className="mt-0.5">
                <ArchiveStatus
                  archiveObject={lastRun?.archive_object}
                  skippedReason={lastRun?.archive_skipped_reason}
                  archiveError={lastRun?.archive_error}
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Next run</dt>
              <dd className="mt-0.5 inline-flex items-center gap-1.5 font-medium">
                <Clock weight="regular" aria-hidden className="size-4 text-muted-foreground" />
                {status?.next_run ? formatDateTime(status.next_run) : '—'}
              </dd>
            </div>
          </dl>
        )}
      </CardBody>
    </Card>
  )
}
