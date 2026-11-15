import { Database, FileArrowUp, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CloudflareSetupStep } from '../components/setup/CloudflareSetupStep'
import { DomainsSetupStep } from '../components/setup/DomainsSetupStep'
import { LogViewer } from '../components/setup/LogViewer'
import { OptionalSetupStep } from '../components/setup/OptionalSetupStep'
import { PanelHostnameSetupStep } from '../components/setup/PanelHostnameSetupStep'
import { ProgressBar } from '../components/setup/ProgressBar'
import {
  RestoreConfirmDialog,
  type RestoreConflict,
} from '../components/setup/RestoreConfirmDialog'
import { RestoreResultSummary } from '../components/setup/RestoreResultSummary'
import { SetupStepper } from '../components/setup/SetupStepper'
import { UploadInfoPanel } from '../components/setup/UploadInfoPanel'
import { authQueryKey } from '../lib/auth'
import { uploadDumpFile, uploadFailureMessage, type UploadProgress } from '../lib/chunkedUpload'
import { ACCEPT, isAcceptedDump } from '../lib/dumpFile'
import { ApiError } from '../lib/api'
import { fetchCloudflareZones, fetchDomains, fetchServerSettings } from '../lib/domainsApi'
import {
  completeSetup,
  fetchSetupState,
  markDatabaseEmpty,
  startSetupRestore,
  type JobEndPayload,
  type SetupStep,
  type UploadCompleteInfo,
} from '../lib/setupApi'
import {
  isCloudflareContinuePending,
  setCloudflareContinuePending,
  setPanelHostnameContinuePending,
  getPanelHostnameContinuePending,
} from '../lib/setupSession'
import { resolveActiveStep } from '../lib/setupWizard'
import { Alert, Button, Card, CardBody, PageHeader, ProductLogo } from '../components/ui'

function stepStatus(steps: SetupStep[], id: SetupStep['id']): string {
  return steps.find((step) => step.id === id)?.status ?? 'pending'
}

export function SetupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)

  const setupQuery = useQuery({
    queryKey: ['setup', 'state'],
    queryFn: fetchSetupState,
    refetchIntervalInBackground: false,
  })

  const [cloudflareZonesRequested, setCloudflareZonesRequested] = useState(
    () => isCloudflareContinuePending(),
  )
  const [awaitingCloudflareContinue, setAwaitingCloudflareContinue] = useState(
    () => isCloudflareContinuePending(),
  )
  const [awaitingPanelHostnameContinue, setAwaitingPanelHostnameContinue] = useState(
    () => getPanelHostnameContinuePending() !== null,
  )
  const [optionalAcknowledged, setOptionalAcknowledged] = useState(false)

  const zonesQuery = useQuery({
    queryKey: ['cloudflare', 'zones'],
    queryFn: fetchCloudflareZones,
    enabled:
      cloudflareZonesRequested ||
      isCloudflareContinuePending() ||
      stepStatus(setupQuery.data?.steps ?? [], 'cloudflare') === 'done',
    refetchIntervalInBackground: false,
  })

  const serverSettingsQuery = useQuery({
    queryKey: ['server-settings'],
    queryFn: fetchServerSettings,
    refetchIntervalInBackground: false,
  })

  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    enabled: stepStatus(setupQuery.data?.steps ?? [], 'cloudflare') === 'done',
    refetchIntervalInBackground: false,
    refetchInterval: 5000,
  })

  const hasValidCert = (domainsQuery.data ?? []).some((row) => row.cert_status === 'valid')

  const [uploadInfo, setUploadInfo] = useState<UploadCompleteInfo | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmDialogKey, setConfirmDialogKey] = useState(0)
  const [restoreConflict, setRestoreConflict] = useState<RestoreConflict | null>(null)
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null)
  const [jobEnd, setJobEnd] = useState<JobEndPayload | null>(null)

  // Resume a restore that is still running after a page refresh.
  const stateRestoreJobId = setupQuery.data?.restore_job_id ?? null
  const effectiveRestoreJobId = restoreJobId ?? stateRestoreJobId
  const [dragOver, setDragOver] = useState(false)

  const steps = useMemo(() => setupQuery.data?.steps ?? [], [setupQuery.data?.steps])
  const databaseStatus = stepStatus(steps, 'database')

  const cloudflareDone = stepStatus(steps, 'cloudflare') === 'done'
  const panelHostnameDone = stepStatus(steps, 'panel_hostname') === 'done'
  const cloudflareAcknowledged = cloudflareDone && !awaitingCloudflareContinue
  const panelHostnameAcknowledged = panelHostnameDone && !awaitingPanelHostnameContinue

  const activeStep = useMemo(
    () =>
      resolveActiveStep(steps, hasValidCert, effectiveRestoreJobId, uploading, uploadInfo, {
        cloudflareAcknowledged,
        panelHostnameAcknowledged,
        optionalAcknowledged,
      }),
    [
      steps,
      hasValidCert,
      effectiveRestoreJobId,
      uploading,
      uploadInfo,
      cloudflareAcknowledged,
      panelHostnameAcknowledged,
      optionalAcknowledged,
    ],
  )

  const emptyMutation = useMutation({
    mutationFn: markDatabaseEmpty,
    onSuccess: (state) => {
      queryClient.setQueryData(['setup', 'state'], state)
    },
  })

  const finishMutation = useMutation({
    mutationFn: completeSetup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKey })
      navigate('/', { replace: true })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: ({ id, overwrite }: { id: string; overwrite: boolean }) =>
      startSetupRestore(id, overwrite),
    onSuccess: (result) => {
      setRestoreJobId(result.job_id)
      setConfirmOpen(false)
      setRestoreConflict(null)
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && err.body && typeof err.body === 'object'
          ? (err.body as { detail?: unknown }).detail
          : null
      if (
        detail &&
        typeof detail === 'object' &&
        (detail as { code?: string }).code === 'cluster_not_empty'
      ) {
        setRestoreConflict(detail as unknown as RestoreConflict)
        setConfirmDialogKey((value) => value + 1)
        setConfirmOpen(true)
      }
    },
  })

  const refreshSetup = useCallback(() => {
    void setupQuery.refetch()
  }, [setupQuery])

  const startUpload = useCallback(async (file: File) => {
    if (!isAcceptedDump(file)) {
      setUploadError('Choose a .sql or .sql.gz dump file.')
      return
    }
    setUploadError(null)
    setUploadInfo(null)
    setUploadProgress(null)
    setUploading(true)
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const result = await uploadDumpFile(file, {
        signal: controller.signal,
        onProgress: setUploadProgress,
      })
      setUploadId(result.uploadId)
      setUploadInfo(result.info)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setUploadError('Upload cancelled.')
      } else {
        setUploadError(uploadFailureMessage(error))
      }
    } finally {
      setUploading(false)
      setUploadProgress(null)
      uploadAbortRef.current = null
    }
  }, [])

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      void startUpload(file)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files.item(0)
    if (file) {
      void startUpload(file)
    }
  }

  const cancelUpload = () => {
    uploadAbortRef.current?.abort()
  }

  const handleJobEnd = useCallback(
    (payload: JobEndPayload) => {
      setJobEnd(payload)
      setRestoreJobId(null)
      void setupQuery.refetch()
    },
    [setupQuery],
  )

  const cloudflareConfigured =
    stepStatus(steps, 'cloudflare') === 'done' || zonesQuery.data?.configured === true

  return (
    <div className="min-h-dvh bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <ProductLogo size="md" showName nameClassName="tracking-tight text-foreground" />

        <PageHeader
          title="First-run setup"
          description="Configure the database, Cloudflare, domains, and panel URL before using the dashboard."
        />

      <SetupStepper active={activeStep} steps={steps} hasValidCert={hasValidCert} />

      {setupQuery.isError ? (
        <Alert tone="danger">Could not load setup status.</Alert>
      ) : null}

      {activeStep === 'database' && databaseStatus === 'pending' && !effectiveRestoreJobId ? (
        <section className="space-y-4" aria-labelledby="database-step-heading">
          <h2 id="database-step-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Database
          </h2>
          <p className="text-base text-muted-foreground">
            Start with an empty PostgreSQL cluster or upload a cluster dump to restore.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={emptyMutation.isPending || uploading}
              className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors duration-150 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => emptyMutation.mutate()}
            >
              <Database weight="regular" aria-hidden className="size-6 text-accent" />
              <span className="text-base font-medium text-foreground">Start empty</span>
              <span className="text-sm text-muted-foreground">
                Keep the default empty cluster and continue setup.
              </span>
            </button>

            <div
              className={`rounded-2xl border border-dashed p-5 shadow-sm transition-colors duration-150 ${
                dragOver ? 'border-accent bg-accent-soft/40' : 'border-border bg-card'
              }`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <FileArrowUp weight="regular" aria-hidden className="size-6 text-foreground" />
              <p className="mt-2 text-base font-medium text-foreground">Upload dump</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Drag and drop a .sql or .sql.gz file, or choose a file.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={onFileInput}
              />
            </div>
          </div>

          {uploading && uploadProgress ? (
            <Card>
              <CardBody className="space-y-3">
                <ProgressBar
                  sent={uploadProgress.sent}
                  total={uploadProgress.total}
                  bytesPerSec={uploadProgress.bytesPerSec}
                  etaSec={uploadProgress.etaSec}
                />
                <Button
                  type="button"
                  variant="secondary"
                  leftIcon={<Trash weight="regular" aria-hidden className="size-4" />}
                  onClick={cancelUpload}
                >
                  Cancel upload
                </Button>
              </CardBody>
            </Card>
          ) : null}

          {uploadError ? <Alert tone="danger">{uploadError}</Alert> : null}

          {uploadInfo ? (
            <div className="space-y-3">
              <UploadInfoPanel info={uploadInfo} />
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setConfirmDialogKey((value) => value + 1)
                  setConfirmOpen(true)
                }}
              >
                Restore from dump
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {effectiveRestoreJobId ? (
        <section className="space-y-3" aria-labelledby="restore-log-heading">
          <h2 id="restore-log-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Restore progress
          </h2>
          <LogViewer key={effectiveRestoreJobId} jobId={effectiveRestoreJobId} onEnd={handleJobEnd} />
        </section>
      ) : null}

      {!effectiveRestoreJobId && jobEnd ? (
        <RestoreResultSummary
          end={jobEnd}
          onContinue={() => {
            setJobEnd(null)
            void setupQuery.refetch()
          }}
          onRetry={() => {
            setJobEnd(null)
            setRestoreJobId(null)
            setUploadInfo(null)
            setUploadId(null)
            void setupQuery.refetch()
          }}
        />
      ) : null}

      {activeStep === 'cloudflare' && !effectiveRestoreJobId ? (
        <CloudflareSetupStep
          configured={cloudflareConfigured}
          zones={zonesQuery.data?.zones ?? []}
          zonesLoading={zonesQuery.isFetching}
          zonesError={
            zonesQuery.isError && !zonesQuery.isFetching
              ? 'Could not load Cloudflare zones.'
              : null
          }
          acmeEmail={serverSettingsQuery.data?.acme_email ?? ''}
          onTokenSaved={() => {
            setCloudflareZonesRequested(true)
            setAwaitingCloudflareContinue(true)
            setCloudflareContinuePending(true)
            refreshSetup()
          }}
          onContinue={() => {
            setAwaitingCloudflareContinue(false)
            setCloudflareContinuePending(false)
          }}
        />
      ) : null}

      {activeStep === 'domains' && !effectiveRestoreJobId ? (
        <DomainsSetupStep onCertReady={refreshSetup} />
      ) : null}

      {activeStep === 'panel_hostname' && !effectiveRestoreJobId ? (
        <PanelHostnameSetupStep
          onSaved={() => {
            setAwaitingPanelHostnameContinue(true)
            refreshSetup()
          }}
          onContinue={() => {
            setAwaitingPanelHostnameContinue(false)
            setPanelHostnameContinuePending(null)
          }}
        />
      ) : null}

      {activeStep === 'optional' && !effectiveRestoreJobId ? (
        <OptionalSetupStep
          onContinueToFinish={() => setOptionalAcknowledged(true)}
          onSkipped={() => finishMutation.mutate()}
        />
      ) : null}

      {activeStep === 'finish' && !effectiveRestoreJobId ? (
        <section className="space-y-3" aria-labelledby="finish-heading">
          <h2 id="finish-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Finish
          </h2>
          <p className="text-base text-muted-foreground">
            {databaseStatus === 'restored'
              ? 'Restore completed. Complete setup to open the dashboard.'
              : 'Configuration is ready. Complete setup to open the dashboard.'}
          </p>
          <Button
            type="button"
            loading={finishMutation.isPending}
            onClick={() => finishMutation.mutate()}
          >
            Finish setup
          </Button>
          {finishMutation.isError ? (
            <Alert tone="danger">Could not complete setup.</Alert>
          ) : null}
        </section>
      ) : null}

      <RestoreConfirmDialog
        key={confirmDialogKey}
        open={confirmOpen}
        busy={restoreMutation.isPending}
        conflict={restoreConflict}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={(overwrite) => {
          if (uploadId) {
            restoreMutation.mutate({ id: uploadId, overwrite })
          }
        }}
      />
      </div>
    </div>
  )
}
