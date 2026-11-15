import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { pruneBuildCache, pruneUnusedImages } from '../../lib/dashboardApi'
import type { DockerDf } from '../../lib/dashboardTypes'
import { formatBytes } from '../../lib/format'
import { SLOW_POLL_STALE_MS, useQueryStale } from '../../hooks/useQueryStale'
import { useTickingNow } from '../../hooks/useTickingNow'
import { formatSecondsAgo } from '../../lib/format'
import { ConfirmDialog } from '../ConfirmDialog'
import { StaleBadge } from '../StatusBadge'
import { Alert, Button, Card, CardBody, Skeleton, useToast } from '../ui'
import { cn } from '../../lib/cn'

export interface DockerDiskCardProps {
  df: DockerDf | undefined
  dataUpdatedAt: number
  isLoading: boolean
  className?: string
}

export function DockerDiskCard({
  df,
  dataUpdatedAt,
  isLoading,
  className = '',
}: DockerDiskCardProps) {
  const [imagesConfirmOpen, setImagesConfirmOpen] = useState(false)
  const [buildCacheConfirmOpen, setBuildCacheConfirmOpen] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const now = useTickingNow()
  const isStale = useQueryStale(dataUpdatedAt, SLOW_POLL_STALE_MS)

  const pruneImagesMutation = useMutation({
    mutationFn: pruneUnusedImages,
    onSuccess: (result) => {
      setImagesConfirmOpen(false)
      setInlineError(null)
      toast({
        title: 'Docker images pruned',
        description: `Reclaimed ${formatBytes(result.reclaimed_bytes)}`,
      })
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

  const pruneBuildCacheMutation = useMutation({
    mutationFn: pruneBuildCache,
    onSuccess: (result) => {
      setBuildCacheConfirmOpen(false)
      setInlineError(null)
      toast({
        title: 'Build cache pruned',
        description: `Reclaimed ${formatBytes(result.reclaimed_bytes)}`,
      })
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

  const anyPrunePending =
    pruneImagesMutation.isPending || pruneBuildCacheMutation.isPending

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
      <Card className={cn('flex min-h-0 flex-col', className)}>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Docker disk</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>updated {formatSecondsAgo(dataUpdatedAt, now)}</span>
              {isStale ? <StaleBadge /> : null}
            </div>
          </div>
          {isLoading && !df ? (
            <div className="space-y-3" aria-busy>
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
              <span className="sr-only">Loading…</span>
            </div>
          ) : (
            <ul className="space-y-3 text-sm">
              {rows.map(({ label, data }) => (
                <li key={label} className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right">
                    <span className="font-mono tabular whitespace-nowrap">
                      {formatBytes(data.size_bytes)} ({data.count})
                    </span>
                    <span className="mt-0.5 block font-mono text-xs tabular whitespace-nowrap text-muted-foreground">
                      {formatBytes(data.reclaimable_bytes)} reclaimable
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={anyPrunePending}
              onClick={() => {
                if (anyPrunePending) {
                  return
                }
                setInlineError(null)
                setImagesConfirmOpen(true)
              }}
            >
              Prune unused images
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={anyPrunePending}
              onClick={() => {
                if (anyPrunePending) {
                  return
                }
                setInlineError(null)
                setBuildCacheConfirmOpen(true)
              }}
            >
              Prune build cache
            </Button>
          </div>
          {inlineError ? <Alert tone="danger">{inlineError}</Alert> : null}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={imagesConfirmOpen}
        title="Prune unused images"
        description="This deletes unused Docker images older than 24 hours. Running containers are not affected."
        confirmLabel="Prune images"
        busy={pruneImagesMutation.isPending}
        onCancel={() => {
          if (!pruneImagesMutation.isPending) {
            setImagesConfirmOpen(false)
          }
        }}
        onConfirm={() => pruneImagesMutation.mutate()}
      />
      <ConfirmDialog
        open={buildCacheConfirmOpen}
        title="Prune build cache"
        description="This deletes unused Docker build cache older than 24 hours. Images and running containers are not affected."
        confirmLabel="Prune build cache"
        busy={pruneBuildCacheMutation.isPending}
        onCancel={() => {
          if (!pruneBuildCacheMutation.isPending) {
            setBuildCacheConfirmOpen(false)
          }
        }}
        onConfirm={() => pruneBuildCacheMutation.mutate()}
      />
    </>
  )
}
