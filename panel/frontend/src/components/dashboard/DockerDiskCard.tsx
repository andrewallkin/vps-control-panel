import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { pruneUnusedImages } from '../../lib/dashboardApi'
import type { DockerDf } from '../../lib/dashboardTypes'
import { formatBytes } from '../../lib/format'
import { SLOW_POLL_STALE_MS, useQueryStale } from '../../hooks/useQueryStale'
import { useTickingNow } from '../../hooks/useTickingNow'
import { formatSecondsAgo } from '../../lib/format'
import { ConfirmDialog } from '../ConfirmDialog'
import { StaleBadge } from '../StatusBadge'
import { Toast } from '../Toast'

export interface DockerDiskCardProps {
  df: DockerDf | undefined
  dataUpdatedAt: number
  isLoading: boolean
}

export function DockerDiskCard({ df, dataUpdatedAt, isLoading }: DockerDiskCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const now = useTickingNow()
  const isStale = useQueryStale(dataUpdatedAt, SLOW_POLL_STALE_MS)

  const pruneMutation = useMutation({
    mutationFn: pruneUnusedImages,
    onSuccess: (result) => {
      setConfirmOpen(false)
      setInlineError(null)
      setToast(`Reclaimed ${formatBytes(result.reclaimed_bytes)}`)
      void queryClient.invalidateQueries({ queryKey: ['docker', 'df'] })
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const body = error.body as { detail?: string }
        setInlineError(body?.detail ?? error.message)
      } else {
        setInlineError('Prune failed')
      }
    },
  })

  const rows = df
    ? [
        { label: 'Images', data: df.images },
        { label: 'Containers', data: df.containers },
        { label: 'Volumes', data: df.volumes },
        { label: 'Build cache', data: df.build_cache },
      ]
    : []

  return (
    <>
      <section className="flex flex-col space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Docker disk</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>updated {formatSecondsAgo(dataUpdatedAt, now)}</span>
            {isStale ? <StaleBadge /> : null}
          </div>
        </div>
        {isLoading && !df ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map(({ label, data }) => (
              <li key={label} className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-xs">
                  {formatBytes(data.size_bytes)} ({data.count}) · reclaimable{' '}
                  {formatBytes(data.reclaimable_bytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => {
            setInlineError(null)
            setConfirmOpen(true)
          }}
        >
          Prune unused images
        </button>
        {inlineError ? (
          <p className="text-sm text-destructive" role="alert">
            {inlineError}
          </p>
        ) : null}
      </section>
      <ConfirmDialog
        open={confirmOpen}
        title="Prune unused images"
        description="This deletes unused Docker images older than 24 hours. Running containers are not affected."
        confirmLabel="Prune images"
        busy={pruneMutation.isPending}
        onCancel={() => {
          if (!pruneMutation.isPending) {
            setConfirmOpen(false)
          }
        }}
        onConfirm={() => pruneMutation.mutate()}
      />
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </>
  )
}
