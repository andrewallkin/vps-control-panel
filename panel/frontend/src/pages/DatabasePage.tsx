import { FileArrowUp, Trash, Warning } from '@phosphor-icons/react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
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
import { uploadDumpFile, uploadFailureMessage, type UploadProgress } from '../lib/chunkedUpload'
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

const secondaryButtonClass =
  'inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

const dangerButtonClass =
  'inline-flex min-h-11 items-center gap-2 rounded-md border border-destructive/50 px-3 text-sm font-medium text-destructive transition-colors duration-200 hover:bg-destructive/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

const primaryButtonClass =
  'inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

const fieldClass =
  'mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed'

const RESTORE_STEPS = [
  'The file is checked as a gzip-compressed pg_dumpall archive.',
  'The dump is loaded. Any errors are written to the restore log.',
  'The admin password is reset from the stack environment.',
  'Project .env files stay unchanged. Role passwords come back from the dump. Rotate the database password for each attached project and deploy so the app can connect.',
]

function databaseSummary(rows: DatabaseRow[]): string {
  const unattached = rows.filter((row) => !row.attached_slug).length
  const noun = rows.length === 1 ? 'database' : 'databases'
  if (unattached === 0) {
    return `${rows.length} ${noun}, all attached to a project`
  }
  if (unattached === rows.length) {
    return `${rows.length} ${noun}, none attached to a project`
  }
  return `${rows.length} ${noun}, ${unattached} not attached to a project`
}

function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const detail = (error.body as { detail?: unknown }).detail
    if (typeof detail === 'string') {
      return detail
    }
  }
  return ''
}

function clusterNotEmptyDetail(error: unknown): RestoreConflict | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') {
    return null
  }
  const detail = (error.body as { detail?: unknown }).detail
  if (
    !detail ||
    typeof detail !== 'object' ||
    (detail as { code?: string }).code !== 'cluster_not_empty'
  ) {
    return null
  }
  return detail as unknown as RestoreConflict
}

export function DatabasePage() {
  const queryClient = useQueryClient()
  const dropConfirmInputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const adoptPanelRef = useRef<HTMLElement>(null)
  const dropPanelRef = useRef<HTMLElement>(null)

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

  useEffect(() => {
    const node = adoptPanelRef.current
    if (adoptTarget && typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [adoptTarget])

  useEffect(() => {
    const node = dropPanelRef.current
    if (dropTarget && typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [dropTarget])

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
        if (clusterNotEmptyDetail(error)) {
          throw error
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
        setUploadError(uploadFailureMessage(error))
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
      const conflict = clusterNotEmptyDetail(err)
      if (conflict) {
        setActionError(null)
        setRestoreConflict(conflict)
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
    <div className="flex w-full flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Database</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          PostgreSQL databases on the central cluster, and dumps for each attached project.
        </p>
      </div>

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}
      {actionMessage ? (
        <p className="text-sm text-muted-foreground" role="status">
          {actionMessage}
        </p>
      ) : null}

      {adoptTarget ? (
        <section
          ref={adoptPanelRef}
          className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6"
          aria-labelledby="adopt-heading"
        >
          <div className="space-y-1">
            <h2 id="adopt-heading" className="text-base font-semibold">
              Adopt <span className="font-mono">{adoptTarget.name}</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Attach this database to a project that does not have one yet.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="adopt-project" className="block text-sm font-medium">
                Project
              </label>
              <select
                id="adopt-project"
                className={fieldClass}
                value={adoptSlug}
                onChange={(event) => setAdoptSlug(event.target.value)}
              >
                <option value="">Select a project</option>
                {adoptableProjects.map((project: ProjectSummary) => (
                  <option key={project.slug} value={project.slug}>
                    {project.display_name} ({project.slug})
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Password</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="adopt-password-mode"
                  checked={passwordMode === 'rotate'}
                  onChange={() => setPasswordMode('rotate')}
                />
                Rotate password (recommended)
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="adopt-password-mode"
                  checked={passwordMode === 'keep'}
                  onChange={() => setPasswordMode('keep')}
                />
                Keep the current password
              </label>
            </fieldset>
          </div>
          {passwordMode === 'keep' ? (
            <div className="max-w-md">
              <label htmlFor="adopt-keep-password" className="block text-sm font-medium">
                Current database password
              </label>
              <input
                id="adopt-keep-password"
                type="password"
                autoComplete="off"
                value={keepPassword}
                onChange={(event) => setKeepPassword(event.target.value)}
                className={fieldClass}
              />
            </div>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={writeDatabaseUrl}
              onChange={(event) => setWriteDatabaseUrl(event.target.checked)}
            />
            Write DATABASE_URL into the project .env
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                !adoptSlug ||
                adoptMutation.isPending ||
                (passwordMode === 'keep' && keepPassword.trim() === '')
              }
              className={primaryButtonClass}
              onClick={submitAdopt}
            >
              Adopt database
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setAdoptTarget(null)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {dropTarget ? (
        <section
          ref={dropPanelRef}
          className="space-y-4 rounded-lg border border-destructive/40 bg-card p-4 sm:p-6"
          aria-labelledby="drop-heading"
        >
          <div className="space-y-1">
            <h2 id="drop-heading" className="text-base font-semibold text-destructive">
              Drop <span className="font-mono">{dropTarget.name}</span>
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              This deletes the database and cannot be undone. Type{' '}
              <span className="font-mono text-foreground">{dropTarget.name}</span> to confirm.
            </p>
          </div>
          <div className="max-w-md">
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
              className={`${fieldClass} font-mono`}
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dropRole}
              disabled={dropMutation.isPending}
              onChange={(event) => setDropRole(event.target.checked)}
            />
            Also drop the database role
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canDrop}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-destructive px-3 text-sm font-medium text-foreground transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
              className={secondaryButtonClass}
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

      {databasesQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load databases.
        </p>
      ) : (
        <section className="space-y-3" aria-labelledby="databases-heading">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="databases-heading" className="text-base font-semibold">
              Databases
            </h2>
            {rows.length > 0 ? (
              <p className="text-sm text-muted-foreground">{databaseSummary(rows)}</p>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Owner
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Size
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Project
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-sm text-muted-foreground">
                      {databasesQuery.isPending ? 'Loading…' : 'No databases yet.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.name} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono font-medium">{row.name}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{row.owner}</td>
                      <td className="px-4 py-3 tabular-nums">{formatBytes(row.size_bytes)}</td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!row.attached_slug ? (
                            <button
                              type="button"
                              className={secondaryButtonClass}
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
                              className={secondaryButtonClass}
                              onClick={() => rotateMutation.mutate(row.attached_slug!)}
                            >
                              Rotate password
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={dangerButtonClass}
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

      {attachedSlugs.length > 0 ? (
        <section className="space-y-3" aria-labelledby="dumps-heading">
          <div className="space-y-1">
            <h2 id="dumps-heading" className="text-base font-semibold">
              Dumps
            </h2>
            <p className="text-sm text-muted-foreground">Saved dumps for attached projects.</p>
          </div>
          {attachedSlugs.map((slug, index) => {
            const dumpQuery = dumpQueries[index]
            const dumps = dumpQuery?.data ?? []
            return (
              <div key={slug} className="overflow-hidden rounded-lg border border-border bg-card">
                <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
                  <Link
                    to={`/projects/${encodeURIComponent(slug)}`}
                    className="text-accent hover:underline"
                  >
                    {slug}
                  </Link>
                </h3>
                <ul className="divide-y divide-border">
                  {dumps.length === 0 ? (
                    <li className="px-4 py-4 text-sm text-muted-foreground">No dumps yet.</li>
                  ) : (
                    dumps.map((dump) => (
                      <li
                        key={dump.name}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm"
                      >
                        <span className="font-mono">{dump.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {formatBytes(dump.size_bytes)} · {dump.created_at}
                        </span>
                        <a
                          href={databaseDumpDownloadUrl(slug, dump.name)}
                          className="font-medium text-accent hover:underline"
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

      <section
        className="overflow-hidden rounded-lg border border-border bg-card"
        aria-labelledby="restore-heading"
      >
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <h2 id="restore-heading" className="text-base font-semibold">
            Cluster restore
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Replace every database on this cluster from one dump. Project files are left as they
            are.
          </p>
        </div>

        {!restoreJobId ? (
          <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
            <div>
              <div className="flex gap-3 rounded-md border border-warning/50 bg-warning/10 px-4 py-3">
                <Warning weight="regular" aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground">Before you restore</p>
                  <p className="text-muted-foreground">
                    If the cluster already has data, project containers that use it are stopped and
                    a safety dump is taken first. Nothing is overwritten until you confirm.
                  </p>
                </div>
              </div>
              <h3 className="mt-5 text-sm font-semibold">What the restore does</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                {RESTORE_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>

            <div className="space-y-3">
              <div
                className={`flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-200 ${
                  dragOver ? 'border-accent bg-muted/50' : 'border-border bg-background'
                }`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <FileArrowUp weight="regular" aria-hidden className="size-6 text-foreground" />
                <p className="mt-3 text-sm font-semibold">Upload a cluster dump</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Drag a .sql or .sql.gz file here, or choose a file. You confirm your password
                  before the upload starts.
                </p>
                <button
                  type="button"
                  disabled={uploading}
                  className={`${secondaryButtonClass} mt-4`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  aria-label="Cluster dump file"
                  className="sr-only"
                  onChange={onFileInput}
                />
              </div>

              {uploading && uploadProgress ? (
                <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                  <ProgressBar
                    sent={uploadProgress.sent}
                    total={uploadProgress.total}
                    bytesPerSec={uploadProgress.bytesPerSec}
                    etaSec={uploadProgress.etaSec}
                  />
                  <button type="button" className={secondaryButtonClass} onClick={cancelUpload}>
                    <Trash weight="regular" aria-hidden className="size-4" />
                    Cancel upload
                  </button>
                </div>
              ) : null}

              {uploadError ? (
                <p className="text-sm text-destructive" role="alert">
                  {uploadError}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-6">
            <LogViewer key={restoreJobId} jobId={restoreJobId} onEnd={handleJobEnd} />
          </div>
        )}

        {!restoreJobId && uploadInfo ? (
          <div className="space-y-3 border-t border-border px-4 py-4 sm:px-6">
            <UploadInfoPanel info={uploadInfo} />
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-foreground transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                setConfirmDialogKey((value) => value + 1)
                setConfirmOpen(true)
              }}
            >
              Restore from dump
            </button>
          </div>
        ) : null}

        {!restoreJobId && jobEnd ? (
          <div className="border-t border-border px-4 py-4 sm:px-6">
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
        attachedProjects={attachedSlugs}
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
