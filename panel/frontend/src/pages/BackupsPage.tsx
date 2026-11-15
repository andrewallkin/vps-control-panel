import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { BackupSettingsForm } from '../components/backups/BackupSettingsForm'
import { BackupStatusCard } from '../components/backups/BackupStatusCard'
import { Button, Card, CardBody, PageHeader, Skeleton, useToast } from '../components/ui'
import {
  fetchBackupSettings,
  fetchBackupStatus,
  runBackupNow,
} from '../lib/backupsApi'

const RUN_POLL_MS = 2000
const RUN_POLL_TIMEOUT_MS = 30000

export function BackupsPage() {
  const { toast } = useToast()
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
      toast({ title: 'Backup run started.', description: 'Waiting for status…' })
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
          toast({ title: 'Backup run finished.' })
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
      <Button
        variant="secondary"
        loading={runMutation.isPending}
        onClick={() => runMutation.mutate()}
      >
        Run backup now
      </Button>
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
      <PageHeader
        title="Backups"
        description="Schedule PostgreSQL dumps to Google Cloud Storage. A passphrase encrypts each dump and adds a second encrypted config file."
      />

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
        <Card>
          <CardBody className="sm:p-6">
            <BackupSettingsForm
              key={settingsQuery.dataUpdatedAt}
              settings={settingsQuery.data}
              onSaved={() => toast({ title: 'Backup settings saved.' })}
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-32 w-full" />
            <span className="sr-only">Loading settings…</span>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
