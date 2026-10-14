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
  const [runMessage, setRunMessage] = useState<{ text: string; error: boolean } | null>(null)
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
      setRunMessage({ text: 'Backup triggered. Waiting for status…', error: false })
      const baseline = statusQuery.data?.last_run?.finished_at ?? null
      clearRunPolling()
      pollRef.current = setInterval(() => {
        void queryClient.invalidateQueries({ queryKey: ['backups', 'status'] })
      }, RUN_POLL_MS)
      timeoutRef.current = setTimeout(() => {
        clearRunPolling()
        setRunMessage({ text: 'Timed out waiting for backup status. Refresh later.', error: false })
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
          setRunMessage({ text: 'Backup run finished.', error: false })
          void queryClient.invalidateQueries({ queryKey: ['backups', 'status'] })
        }
      })
    },
    onError: () => {
      setRunMessage({ text: 'Could not start backup run.', error: true })
    },
  })

  const runAction = (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        disabled={runMutation.isPending}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => runMutation.mutate()}
      >
        {runMutation.isPending ? (
          <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
        ) : null}
        Run backup now
      </button>
      {runMessage ? (
        runMessage.error ? (
          <p className="text-sm text-destructive" role="alert">
            {runMessage.text}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{runMessage.text}</p>
        )
      ) : null}
    </div>
  )

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Backups</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Schedule PostgreSQL dumps to Google Cloud Storage. A passphrase encrypts each dump and
          adds a second encrypted config file.
        </p>
      </div>

      <BackupStatusCard
        status={statusQuery.data}
        loading={statusQuery.isPending}
        actions={runAction}
      />

      {settingsQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load backup settings.
        </p>
      ) : settingsQuery.data ? (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
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
