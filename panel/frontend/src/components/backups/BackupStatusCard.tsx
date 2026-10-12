import { CheckCircle, Clock, Warning, XCircle } from '@phosphor-icons/react'
import { StatusBadge } from '../StatusBadge'
import { formatBytes } from '../../lib/format'
import type { BackupStatus } from '../../lib/backupsApi'

function ResultStatus({ success, error }: { success?: boolean; error?: string | null }) {
  if (success === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        <span>Success</span>
      </span>
    )
  }
  if (success === false || error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
        <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        <span>Failed</span>
      </span>
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
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
        <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        <span>{archiveError}</span>
      </span>
    )
  }
  if (archiveObject) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        <span className="font-mono text-xs">{archiveObject}</span>
      </span>
    )
  }
  if (skippedReason) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning">
        <Warning weight="regular" aria-hidden className="size-4 shrink-0" />
        <span>{skippedReason}</span>
      </span>
    )
  }
  return <span className="text-sm text-muted-foreground">—</span>
}

export interface BackupStatusCardProps {
  status: BackupStatus | undefined
  loading?: boolean
}

export function BackupStatusCard({ status, loading }: BackupStatusCardProps) {
  const lastRun = status?.last_run ?? null
  const failed = lastRun?.success === false || Boolean(lastRun?.error)

  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-labelledby="backup-status-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="backup-status-heading" className="text-base font-semibold">
          Backup status
        </h2>
        {status?.overdue ? <StatusBadge variant="warning" label="Overdue" /> : null}
        {failed ? <StatusBadge variant="critical" label="Last run failed" /> : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading status…</p>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Last run</dt>
            <dd className="mt-0.5 font-medium">
              {lastRun?.finished_at
                ? new Date(lastRun.finished_at).toLocaleString()
                : 'Never'}
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
              {status?.next_run ? new Date(status.next_run).toLocaleString() : '—'}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}
