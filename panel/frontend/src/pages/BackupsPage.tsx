import { Spinner } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { BackupSettingsForm } from '../components/backups/BackupSettingsForm'
import { BackupStatusCard } from '../components/backups/BackupStatusCard'
import {
  fetchBackupSettings,
  fetchBackupStatus,
  runBackupNow,
} from '../lib/backupsApi'

const RUN_POLL_MS = 2000
const RUN_POLL_TIMEOUT_MS = 30000

export function BackupsPage() {
  const queryClient = useQueryClient()
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['backups', 'settings'],
    queryFn: fetchBackupSettings,
    refetchIntervalInBackground: false,
  })

  const statusQuery = useQuery({
    queryKey: ['backups', 'status'],
    queryFn: fetchBackupStatus,
    refetchIntervalInBackground: false,
  })

  const clearRunPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const runMutation = useMutation({
    mutationFn: runBackupNow,
    onSuccess: async () => {
      setRunMessage('Backup triggered. Waiting for status…')
      const baseline = statusQuery.data?.last_run?.finished_at ?? null
      clearRunPolling()
      pollRef.current = setInterval(() => {
        void queryClient.invalidateQueries({ queryKey: ['backups', 'status'] })
      }, RUN_POLL_MS)
      timeoutRef.current = setTimeout(() => {
        clearRunPolling()
        setRunMessage('Timed out waiting for backup status. Refresh later.')
      }, RUN_POLL_TIMEOUT_MS)

      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.query.queryKey[0] !== 'backups') {
          return
        }
        const data = event.query.state.data as Awaited<ReturnType<typeof fetchBackupStatus>> | undefined
        const finishedAt = data?.last_run?.finished_at ?? null
        if (finishedAt && finishedAt !== baseline) {
          clearRunPolling()
          unsubscribe()
          setRunMessage('Backup run finished.')
          void queryClient.invalidateQueries({ queryKey: ['backups', 'status'] })
        }
      })
    },
    onError: () => {
      setRunMessage('Could not start backup run.')
    },
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Backups</h1>
        <p className="text-sm text-muted-foreground">
          Schedule PostgreSQL dumps to Google Cloud Storage and optional encrypted config archives.
        </p>
      </div>

      <BackupStatusCard status={statusQuery.data} loading={statusQuery.isPending} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={runMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
          onClick={() => runMutation.mutate()}
        >
          {runMutation.isPending ? (
            <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          ) : null}
          Run backup now
        </button>
        {runMessage ? <p className="text-sm text-muted-foreground">{runMessage}</p> : null}
      </div>

      {settingsQuery.isError ? (
        <p className="text-sm text-destructive">Could not load backup settings.</p>
      ) : settingsQuery.data ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <BackupSettingsForm
            key={settingsQuery.dataUpdatedAt}
            settings={settingsQuery.data}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      )}
    </div>
  )
}
