import { FileArrowUp, Trash } from '@phosphor-icons/react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { StepUpDialog } from '../components/StepUpDialog'
import { LogViewer } from '../components/setup/LogViewer'
import { ProgressBar } from '../components/setup/ProgressBar'
import {
  RestoreConfirmDialog,
  type RestoreConflict,
} from '../components/setup/RestoreConfirmDialog'
import { RestoreResultSummary } from '../components/setup/RestoreResultSummary'
import { UploadInfoPanel } from '../components/setup/UploadInfoPanel'
import { ApiError, isStepUpRequired } from '../lib/api'
import { authQueryKey } from '../lib/auth'
import { uploadDumpFile, type UploadProgress } from '../lib/chunkedUpload'
import { ACCEPT, isAcceptedDump } from '../lib/dumpFile'
import {
  adoptDatabase,
  databaseDumpDownloadUrl,
  dropDatabase,
  fetchDatabaseDumps,
  fetchDatabases,
  rotateDatabasePassword,
  type AdoptDatabasePayload,
  type DatabaseRow,
  type DropDatabasePayload,
} from '../lib/databaseApi'
import { formatBytes } from '../lib/format'
import { fetchProjects, type ProjectSummary } from '../lib/projectsApi'
import {
  startSetupRestore,
  type JobEndPayload,
  type UploadCompleteInfo,
} from '../lib/setupApi'



type PendingStepUp =
  | { kind: 'upload'; file: File }
  | { kind: 'restore'; overwrite: boolean }
  | { kind: 'adopt'; payload: AdoptDatabasePayload }
  | { kind: 'rotate'; slug: string }
  | { kind: 'drop'; payload: DropDatabasePayload }
  | null

function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const detail = (error.body as { detail?: unknown }).detail
    if (typeof detail === 'string') {
      return detail
    }
  }
  return ''
}

export function DatabasePage() {
  const queryClient = useQueryClient()
  const dropConfirmInputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)

  const databasesQuery = useQuery({
    queryKey: ['database', 'databases'],
    queryFn: fetchDatabases,
    refetchIntervalInBackground: false,
  })

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    refetchIntervalInBackground: false,
  })

  const adoptableProjects = useMemo(
    () => (projectsQuery.data ?? []).filter((p) => p.database_mode === 'none'),
    [projectsQuery.data],
  )

  const attachedSlugs = useMemo(() => {
    const slugs = new Set<string>()
    for (const row of databasesQuery.data ?? []) {
      if (row.attached_slug) {
        slugs.add(row.attached_slug)
      }
    }
    return [...slugs].sort()
  }, [databasesQuery.data])

  const dumpQueries = useQueries({
    queries: attachedSlugs.map((slug) => ({
      queryKey: ['database', 'dumps', slug],
      queryFn: () => fetchDatabaseDumps(slug),
      refetchIntervalInBackground: false,
    })),
  })

  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [pendingStepUp, setPendingStepUp] = useState<PendingStepUp>(null)

  const [adoptTarget, setAdoptTarget] = useState<DatabaseRow | null>(null)
  const [adoptSlug, setAdoptSlug] = useState('')
  const [passwordMode, setPasswordMode] = useState<'rotate' | 'keep'>('rotate')
  const [keepPassword, setKeepPassword] = useState('')
  const [writeDatabaseUrl, setWriteDatabaseUrl] = useState(true)

  const [dropTarget, setDropTarget] = useState<DatabaseRow | null>(null)
  const [dropConfirmText, setDropConfirmText] = useState('')
  const [dropRole, setDropRole] = useState(false)

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
  const [dragOver, setDragOver] = useState(false)

  const invalidateDatabaseData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['database'] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
  }, [queryClient])

  const runWithStepUp = useCallback(
    async (action: PendingStepUp, fn: () => Promise<void>) => {
      setActionError(null)
      try {
        await fn()
        await invalidateDatabaseData()
        await queryClient.invalidateQueries({ queryKey: authQueryKey })
      } catch (error) {
        if (isStepUpRequired(error)) {
          setPendingStepUp(action)
          setStepUpOpen(true)
          return
        }
        setActionError(apiErrorDetail(error) || 'Request failed.')
      }
    },
    [invalidateDatabaseData, queryClient],
  )

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
      } else if (isStepUpRequired(error)) {
        setPendingStepUp({ kind: 'upload', file })
        setStepUpOpen(true)
      } else {
        setUploadError('Upload failed. Try again.')
      }
    } finally {
      setUploading(false)
      setUploadProgress(null)
      uploadAbortRef.current = null
    }
  }, [])

  const queueUpload = (file: File) => {
    setPendingStepUp({ kind: 'upload', file })
    setStepUpOpen(true)
  }

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      queueUpload(file)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files.item(0)
    if (file) {
      queueUpload(file)
    }
  }

  const cancelUpload = () => {
    uploadAbortRef.current?.abort()
  }

  const handleJobEnd = useCallback(
    (payload: JobEndPayload) => {
      setJobEnd(payload)
      setRestoreJobId(null)
      void invalidateDatabaseData()
    },
    [invalidateDatabaseData],
  )

  const adoptMutation = useMutation({
    mutationFn: (payload: AdoptDatabasePayload) =>
      runWithStepUp({ kind: 'adopt', payload }, async () => {
        const result = await adoptDatabase(payload)
        if (result.restart_required) {
          setActionMessage('Database adopted. Restart project containers to apply the new password.')
        }
        setAdoptTarget(null)
        setAdoptSlug('')
        setPasswordMode('rotate')
        setKeepPassword('')
      }),
  })

  const rotateMutation = useMutation({
    mutationFn: (slug: string) =>
      runWithStepUp({ kind: 'rotate', slug }, async () => {
        const result = await rotateDatabasePassword(slug)
        if (result.restart_required) {
          setActionMessage('Password rotated. Restart project containers to apply the new password.')
        }
      }),
  })

  const dropMutation = useMutation({
    mutationFn: (payload: DropDatabasePayload) =>
      runWithStepUp({ kind: 'drop', payload }, async () => {
        await dropDatabase(payload)
        setDropTarget(null)
        setDropConfirmText('')
        setDropRole(false)
        setActionMessage('Database dropped.')
      }),
  })

  const restoreMutation = useMutation({
    mutationFn: ({ id, overwrite }: { id: string; overwrite: boolean }) =>
      runWithStepUp({ kind: 'restore', overwrite }, async () => {
        const result = await startSetupRestore(id, overwrite)
        setRestoreJobId(result.job_id)
        setConfirmOpen(false)
        setRestoreConflict(null)
      }),
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

  const onStepUpVerified = () => {
    setStepUpOpen(false)
    const pending = pendingStepUp
    setPendingStepUp(null)
    if (!pending) {
      return
    }
    if (pending.kind === 'upload') {
      void startUpload(pending.file)
      return
    }
    if (pending.kind === 'restore' && uploadId) {
      restoreMutation.mutate({ id: uploadId, overwrite: pending.overwrite })
      return
    }
    if (pending.kind === 'adopt') {
      adoptMutation.mutate(pending.payload)
      return
    }
    if (pending.kind === 'rotate') {
      rotateMutation.mutate(pending.slug)
      return
    }
    if (pending.kind === 'drop') {
      dropMutation.mutate(pending.payload)
    }
  }

  const submitAdopt = () => {
    if (!adoptTarget || !adoptSlug) {
      return
    }
    const payload: AdoptDatabasePayload = {
      slug: adoptSlug,
      db_name: adoptTarget.name,
      db_user: adoptTarget.owner,
      password_mode: passwordMode,
      password: passwordMode === 'keep' ? keepPassword : null,
      write_database_url: writeDatabaseUrl,
    }
    adoptMutation.mutate(payload)
  }

  const canDrop =
    dropTarget !== null && dropConfirmText === dropTarget.name && !dropMutation.isPending

  const rows = databasesQuery.data ?? []

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Database</h1>
        <p className="text-sm text-muted-foreground">
          PostgreSQL databases on the central cluster and per-project dumps.
        </p>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      {actionMessage ? <p className="text-sm text-muted-foreground">{actionMessage}</p> : null}

      {databasesQuery.isError ? (
        <p className="text-sm text-destructive">Could not load databases.</p>
      ) : (
        <section className="space-y-3" aria-labelledby="databases-heading">
          <h2 id="databases-heading" className="text-base font-semibold">
            Databases
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                      {databasesQuery.isPending ? 'Loading…' : 'No databases found.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.name}>
                      <td className="px-3 py-2 font-mono">{row.name}</td>
                      <td className="px-3 py-2 font-mono">{row.owner}</td>
                      <td className="px-3 py-2">{formatBytes(row.size_bytes)}</td>
                      <td className="px-3 py-2">
                        {row.attached_slug ? (
                          <Link
                            to={`/projects/${encodeURIComponent(row.attached_slug)}`}
                            className="font-medium text-accent hover:underline"
                          >
                            {row.attached_slug}
                          </Link>
                        ) : (
                          <StatusBadge variant="warning" label="Unattached" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {!row.attached_slug ? (
                            <button
                              type="button"
                              className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted cursor-pointer"
                              onClick={() => {
                                setAdoptTarget(row)
                                setAdoptSlug('')
                                setPasswordMode('rotate')
                                setKeepPassword('')
                                setWriteDatabaseUrl(true)
                              }}
                            >
                              Adopt
                            </button>
                          ) : null}
                          {row.attached_slug ? (
                            <button
                              type="button"
                              disabled={rotateMutation.isPending}
                              className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted cursor-pointer disabled:opacity-50"
                              onClick={() => rotateMutation.mutate(row.attached_slug!)}
                            >
                              Rotate password
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded-md border border-destructive/50 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 cursor-pointer"
                            onClick={() => {
                              setDropTarget(row)
                              setDropConfirmText('')
                              setDropRole(false)
                            }}
                          >
                            Drop
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {adoptTarget ? (
        <section
          className="space-y-3 rounded-lg border border-border bg-card p-4"
          aria-labelledby="adopt-heading"
        >
          <h2 id="adopt-heading" className="text-sm font-semibold">
            Adopt {adoptTarget.name}
          </h2>
          <div className="space-y-2">
            <label htmlFor="adopt-project" className="text-sm font-medium">
              Project (no database)
            </label>
            <select
              id="adopt-project"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={adoptSlug}
              onChange={(event) => setAdoptSlug(event.target.value)}
            >
              <option value="">Select project</option>
              {adoptableProjects.map((project: ProjectSummary) => (
                <option key={project.slug} value={project.slug}>
                  {project.display_name} ({project.slug})
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Password</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="adopt-password-mode"
                checked={passwordMode === 'rotate'}
                onChange={() => setPasswordMode('rotate')}
              />
              Rotate password (recommended)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="adopt-password-mode"
                checked={passwordMode === 'keep'}
                onChange={() => setPasswordMode('keep')}
              />
              Keep existing password
            </label>
          </fieldset>
          {passwordMode === 'keep' ? (
            <div className="space-y-2">
              <label htmlFor="adopt-keep-password" className="text-sm font-medium">
                Current database password
              </label>
              <input
                id="adopt-keep-password"
                type="password"
                autoComplete="off"
                value={keepPassword}
                onChange={(event) => setKeepPassword(event.target.value)}
                className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={writeDatabaseUrl}
              onChange={(event) => setWriteDatabaseUrl(event.target.checked)}
            />
            Write DATABASE_URL to project .env
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                !adoptSlug ||
                adoptMutation.isPending ||
                (passwordMode === 'keep' && keepPassword.trim() === '')
              }
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
              onClick={submitAdopt}
            >
              Adopt database
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted cursor-pointer"
              onClick={() => setAdoptTarget(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {dropTarget ? (
        <section
          className="space-y-3 rounded-lg border border-destructive/40 bg-card p-4"
          aria-labelledby="drop-heading"
        >
          <h2 id="drop-heading" className="text-sm font-semibold text-destructive">
            Drop {dropTarget.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            Type{' '}
            <span className="font-mono text-foreground">{dropTarget.name}</span> to confirm. This
            cannot be undone.
          </p>
          <label className="block text-sm font-medium" htmlFor={dropConfirmInputId}>
            Type database name to confirm
          </label>
          <input
            id={dropConfirmInputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            disabled={dropMutation.isPending}
            value={dropConfirmText}
            onChange={(event) => setDropConfirmText(event.target.value)}
            className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dropRole}
              disabled={dropMutation.isPending}
              onChange={(event) => setDropRole(event.target.checked)}
            />
            Drop role
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canDrop}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
              onClick={() => {
                if (!dropTarget) {
                  return
                }
                setPendingStepUp({
                  kind: 'drop',
                  payload: {
                    db_name: dropTarget.name,
                    confirm: dropConfirmText,
                    drop_role: dropRole,
                  },
                })
                setStepUpOpen(true)
              }}
            >
              Drop database
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted cursor-pointer"
              onClick={() => {
                setDropTarget(null)
                setDropConfirmText('')
                setDropRole(false)
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {attachedSlugs.length > 0 ? (
        <section className="space-y-4" aria-labelledby="dumps-heading">
          <h2 id="dumps-heading" className="text-base font-semibold">
            Dumps
          </h2>
          {attachedSlugs.map((slug, index) => {
            const dumpQuery = dumpQueries[index]
            const dumps = dumpQuery?.data ?? []
            return (
              <div key={slug} className="space-y-2">
                <h3 className="text-sm font-medium">
                  <Link
                    to={`/projects/${encodeURIComponent(slug)}`}
                    className="text-accent hover:underline"
                  >
                    {slug}
                  </Link>
                </h3>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {dumps.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No dumps yet.</li>
                  ) : (
                    dumps.map((dump) => (
                      <li
                        key={dump.name}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="font-mono">{dump.name}</span>
                        <span className="text-muted-foreground">
                          {formatBytes(dump.size_bytes)} · {dump.created_at}
                        </span>
                        <a
                          href={databaseDumpDownloadUrl(slug, dump.name)}
                          className="text-accent hover:underline"
                        >
                          Download
                        </a>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )
          })}
        </section>
      ) : null}

      <section className="space-y-4" aria-labelledby="restore-heading">
        <h2 id="restore-heading" className="text-base font-semibold">
          Cluster restore
        </h2>
        <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm">
          <p className="font-medium text-destructive">Before you restore</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>The file is validated as a gzip-compressed pg_dumpall archive.</li>
            <li>
              If the cluster is not empty, project containers that use it are stopped and a safety
              dump is taken first.
            </li>
            <li>The dump is loaded; errors are recorded in the restore log.</li>
            <li>The admin password is reset from the stack environment.</li>
            <li>Project .env files are not changed automatically.</li>
            <li>Restored role passwords stay as in the dump until you rotate them.</li>
          </ul>
        </div>

        {!restoreJobId ? (
          <>
            <div
              className={`rounded-lg border border-dashed p-4 transition-colors duration-200 ${
                dragOver ? 'border-accent bg-muted/50' : 'border-border bg-card'
              }`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <FileArrowUp weight="regular" aria-hidden className="size-6 text-foreground" />
              <p className="mt-2 font-medium">Upload cluster dump</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Drag and drop a .sql or .sql.gz file, or choose a file. Step-up is required before
                upload.
              </p>
              <button
                type="button"
                disabled={uploading}
                className="mt-3 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={onFileInput}
              />
            </div>

            {uploading && uploadProgress ? (
              <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <ProgressBar
                  sent={uploadProgress.sent}
                  total={uploadProgress.total}
                  bytesPerSec={uploadProgress.bytesPerSec}
                  etaSec={uploadProgress.etaSec}
                />
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
                  onClick={cancelUpload}
                >
                  <Trash weight="regular" aria-hidden className="size-4" />
                  Cancel upload
                </button>
              </div>
            ) : null}

            {uploadError ? <p className="text-sm text-destructive">{uploadError}</p> : null}

            {uploadInfo ? (
              <div className="space-y-3">
                <UploadInfoPanel info={uploadInfo} />
                <button
                  type="button"
                  className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:opacity-90 cursor-pointer"
                  onClick={() => {
                    setConfirmDialogKey((value) => value + 1)
                    setConfirmOpen(true)
                  }}
                >
                  Restore from dump
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-3">
            <LogViewer key={restoreJobId} jobId={restoreJobId} onEnd={handleJobEnd} />
          </div>
        )}
        {!restoreJobId && jobEnd ? (
          <div className="mt-3">
            <RestoreResultSummary
              end={jobEnd}
              onContinue={() => {
                setJobEnd(null)
                void invalidateDatabaseData()
              }}
              onRetry={() => {
                setJobEnd(null)
                setUploadInfo(null)
                setUploadId(null)
              }}
            />
          </div>
        ) : null}
      </section>

      <RestoreConfirmDialog
        key={confirmDialogKey}
        open={confirmOpen}
        busy={restoreMutation.isPending}
        conflict={restoreConflict}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={(overwrite) => {
          if (!uploadId) {
            return
          }
          setPendingStepUp({ kind: 'restore', overwrite })
          setStepUpOpen(true)
        }}
      />

      <StepUpDialog
        open={stepUpOpen}
        busy={
          adoptMutation.isPending ||
          rotateMutation.isPending ||
          dropMutation.isPending ||
          restoreMutation.isPending ||
          uploading
        }
        onVerified={onStepUpVerified}
        onCancel={() => {
          setStepUpOpen(false)
          setPendingStepUp(null)
        }}
      />
    </div>
  )
}
