import { CheckCircle, Spinner } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BackupSettingsForm } from '../backups/BackupSettingsForm'
import { StepUpDialog } from '../StepUpDialog'
import { isStepUpRequired } from '../../lib/api'
import { fetchBackupSettings } from '../../lib/backupsApi'
import { authQueryKey } from '../../lib/auth'
import { fetchRegistryStatus, setRegistryCredentials } from '../../lib/registryApi'
import { completeSetup } from '../../lib/setupApi'

export interface OptionalSetupStepProps {
  onContinueToFinish: () => void
  onSkipped: () => void
}

export function OptionalSetupStep({ onContinueToFinish, onSkipped }: OptionalSetupStepProps) {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [registrySuccess, setRegistrySuccess] = useState<string | null>(null)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [registryHidden, setRegistryHidden] = useState(false)
  const [backupHidden, setBackupHidden] = useState(false)
  const [pendingRegistry, setPendingRegistry] = useState<{ username: string; token: string } | null>(
    null,
  )

  const registryQuery = useQuery({
    queryKey: ['registry', 'status'],
    queryFn: fetchRegistryStatus,
    refetchIntervalInBackground: false,
  })

  const backupQuery = useQuery({
    queryKey: ['backups', 'settings'],
    queryFn: fetchBackupSettings,
    refetchIntervalInBackground: false,
  })

  const skipMutation = useMutation({
    mutationFn: completeSetup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKey })
      onSkipped()
    },
  })

  const saveRegistry = async (body: { username: string; token: string }) => {
    setRegistryError(null)
    setRegistrySuccess(null)
    try {
      await setRegistryCredentials(body)
      setRegistrySuccess('Docker Hub credentials saved.')
      setUsername('')
      setToken('')
      await queryClient.invalidateQueries({ queryKey: ['registry', 'status'] })
    } catch (error) {
      if (isStepUpRequired(error)) {
        setPendingRegistry(body)
        setStepUpOpen(true)
        return
      }
      setRegistryError('Could not save Docker Hub credentials.')
    }
  }

  const registryMutation = useMutation({
    mutationFn: (body: { username: string; token: string }) => saveRegistry(body),
  })

  const registryConfigured = registryQuery.data?.configured === true

  return (
    <section className="space-y-6" aria-labelledby="optional-step-heading">
      <div className="space-y-2">
        <h2 id="optional-step-heading" className="text-base font-semibold">
          Optional
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure Docker Hub pulls and backups now, or skip and finish setup.
        </p>
      </div>

      {registryHidden ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">Docker Hub skipped.</p>
          <button
            type="button"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
            onClick={() => setRegistryHidden(false)}
          >
            Configure instead
          </button>
        </div>
      ) : (
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Docker Hub</h3>
          <button
            type="button"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
            onClick={() => setRegistryHidden(true)}
          >
            Skip section
          </button>
        </div>
        {registryConfigured ? (
          <p className="inline-flex items-center gap-2 text-sm">
            <CheckCircle weight="regular" aria-hidden className="size-4 text-accent" />
            Configured as{' '}
            <span className="font-mono">{registryQuery.data?.username ?? '—'}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not configured</p>
        )}
        {registryError ? <p className="text-sm text-destructive">{registryError}</p> : null}
        {registrySuccess ? (
          <p className="inline-flex items-center gap-2 text-sm text-accent">
            <CheckCircle weight="regular" aria-hidden className="size-4" />
            {registrySuccess}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="setup-registry-username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="setup-registry-username"
              type="text"
              autoComplete="username"
              value={username}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="setup-registry-token" className="text-sm font-medium">
              Access token
            </label>
            <input
              id="setup-registry-token"
              type="password"
              autoComplete="new-password"
              value={token}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          disabled={!username.trim() || !token.trim() || registryMutation.isPending}
          className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
          onClick={() =>
            registryMutation.mutate({ username: username.trim(), token: token.trim() })
          }
        >
          Save Docker Hub credentials
        </button>
      </div>
      )}

      {backupHidden ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">Backups skipped.</p>
          <button
            type="button"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
            onClick={() => setBackupHidden(false)}
          >
            Configure instead
          </button>
        </div>
      ) : (
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Backups</h3>
          <button
            type="button"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
            onClick={() => setBackupHidden(true)}
          >
            Skip section
          </button>
        </div>
        {backupQuery.data ? (
          <BackupSettingsForm
            key={backupQuery.dataUpdatedAt}
            settings={backupQuery.data}
            idPrefix="setup-backup"
            showHeading={false}
          />
        ) : backupQuery.isError ? (
          <p className="text-sm text-destructive">Could not load backup settings.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading backup settings…</p>
        )}
      </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={skipMutation.isPending}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
          onClick={() => skipMutation.mutate()}
        >
          {skipMutation.isPending ? (
            <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          ) : (
            'Skip'
          )}
        </button>
        <button
          type="button"
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer"
          onClick={onContinueToFinish}
        >
          Continue to finish
        </button>
      </div>

      <StepUpDialog
        key={stepUpOpen ? 'optional-step-up-open' : 'optional-step-up-closed'}
        open={stepUpOpen}
        onCancel={() => {
          setStepUpOpen(false)
          setPendingRegistry(null)
        }}
        onVerified={() => {
          setStepUpOpen(false)
          const body = pendingRegistry
          setPendingRegistry(null)
          if (body) {
            void saveRegistry(body)
          }
        }}
      />
    </section>
  )
}
