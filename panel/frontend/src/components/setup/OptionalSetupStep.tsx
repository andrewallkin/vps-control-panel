import { CheckCircle } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BackupSettingsForm } from '../backups/BackupSettingsForm'
import { StepUpDialog } from '../StepUpDialog'
import { isStepUpRequired } from '../../lib/api'
import { fetchBackupSettings } from '../../lib/backupsApi'
import { authQueryKey } from '../../lib/auth'
import { fetchRegistryStatus, setRegistryCredentials } from '../../lib/registryApi'
import { completeSetup } from '../../lib/setupApi'
import { Alert, Button, Card, CardBody, Field, Input } from '../ui'

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
    <section className="space-y-4" aria-labelledby="optional-step-heading">
      <div className="space-y-2">
        <h2 id="optional-step-heading" className="text-base font-semibold">
          Optional
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure Docker Hub pulls and backups now, or skip and finish setup.
        </p>
      </div>

      {registryHidden ? (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-2 py-3">
            <p className="text-sm text-muted-foreground">Docker Hub skipped.</p>
            <button
              type="button"
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
              onClick={() => setRegistryHidden(false)}
            >
              Configure instead
            </button>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="space-y-3">
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
              <p className="inline-flex items-center gap-2 text-sm font-medium">
                <CheckCircle weight="regular" aria-hidden className="size-4 text-accent" />
                Configured as{' '}
                <span className="font-mono">{registryQuery.data?.username ?? '—'}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not configured</p>
            )}
            {registryError ? <Alert tone="danger">{registryError}</Alert> : null}
            {registrySuccess ? (
              <p className="inline-flex items-center gap-2 text-sm font-medium text-accent">
                <CheckCircle weight="regular" aria-hidden className="size-4" />
                {registrySuccess}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Username">
                {(control) => (
                  <Input
                    {...control}
                    id="setup-registry-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Access token">
                {(control) => (
                  <Input
                    {...control}
                    id="setup-registry-token"
                    type="password"
                    autoComplete="current-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button
              type="button"
              disabled={!username.trim() || !token.trim()}
              loading={registryMutation.isPending}
              onClick={() =>
                registryMutation.mutate({ username: username.trim(), token: token.trim() })
              }
            >
              Save Docker Hub credentials
            </Button>
          </CardBody>
        </Card>
      )}

      {backupHidden ? (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-2 py-3">
            <p className="text-sm text-muted-foreground">Backups skipped.</p>
            <button
              type="button"
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
              onClick={() => setBackupHidden(false)}
            >
              Configure instead
            </button>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="space-y-3">
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
              <Alert tone="danger">Could not load backup settings.</Alert>
            ) : (
              <p className="text-sm text-muted-foreground">Loading backup settings…</p>
            )}
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={skipMutation.isPending}
          onClick={() => skipMutation.mutate()}
        >
          Skip
        </Button>
        <Button type="button" onClick={onContinueToFinish}>
          Continue to finish
        </Button>
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