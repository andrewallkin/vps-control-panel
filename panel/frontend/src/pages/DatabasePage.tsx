import { Database, FileArrowUp, Info, Trash } from '@phosphor-icons/react'
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
import { Link, useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { TableSkeletonRows } from '../components/dashboard/TableSkeletonRows'
import { StepUpDialog } from '../components/StepUpDialog'
import { LogViewer } from '../components/setup/LogViewer'
import { ProgressBar } from '../components/setup/ProgressBar'
import {
  RestoreConfirmDialog,
  type RestoreConflict,
} from '../components/setup/RestoreConfirmDialog'
import { RestoreResultSummary } from '../components/setup/RestoreResultSummary'
import { UploadInfoPanel } from '../components/setup/UploadInfoPanel'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui'
import { ApiError, apiErrorDetail, isStepUpRequired } from '../lib/api'
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
import { formatBytes, formatDateTime, formatRelativeTime } from '../lib/format'
import { useTickingNow } from '../hooks/useTickingNow'
import { deployToApplyEnv, fetchProjects, type ProjectSummary } from '../lib/projectsApi'
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
  const { toast } = useToast()
  const nowMs = useTickingNow(60_000)
  const navigate = useNavigate()
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
  const [deployPromptSlug, setDeployPromptSlug] = useState<string | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [pendingStepUp, setPendingStepUp] = useState<PendingStepUp>(null)

  const [adoptTarget, setAdoptTarget] = useState<DatabaseRow | null>(null)
  const [adoptSlug, setAdoptSlug] = useState('')
  const [passwordMode, setPasswordMode] = useState<'rotate' | 'keep'>('rotate')
  const [keepPassword, setKeepPassword] = useState('')
  const [writeDatabaseUrl, setWriteDatabaseUrl] = useState(false)

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
      toast({ title: 'Dump uploaded.' })
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
  }, [toast])

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
        } else {
          setActionMessage(null)
        }
        toast({ title: 'Database adopted.' })
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
          setActionMessage(null)
          setDeployError(null)
          setDeployPromptSlug(slug)
        }
        toast({ title: 'Database password rotated.' })
      }),
  })

  const dropMutation = useMutation({
    mutationFn: (payload: DropDatabasePayload) =>
      runWithStepUp({ kind: 'drop', payload }, async () => {
        await dropDatabase(payload)
        setDropTarget(null)
        setDropConfirmText('')
        setDropRole(false)
        setActionMessage(null)
        toast({ title: 'Database dropped.' })
      }),
  })

  const restoreMutation = useMutation({
    mutationFn: ({ id, overwrite }: { id: string; overwrite: boolean }) =>
      runWithStepUp({ kind: 'restore', overwrite }, async () => {
        const result = await startSetupRestore(id, overwrite)
        setRestoreJobId(result.job_id)
        setConfirmOpen(false)
        setRestoreConflict(null)
        toast({ title: 'Cluster restore started.' })
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

  const applyDeployMutation = useMutation({
    mutationFn: (slug: string) => deployToApplyEnv(slug),
    onSuccess: (_data, slug) => {
      setDeployPromptSlug(null)
      setDeployError(null)
      navigate(`/projects/${slug}#deploy`)
    },
    onError: (error) => {
      setDeployError(apiErrorDetail(error) || 'Deploy failed.')
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
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Database"
        description="PostgreSQL databases on the central cluster, and dumps for each attached project."
      />

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
        <section ref={adoptPanelRef} aria-labelledby="adopt-heading">
          <Card className="space-y-4 p-4 sm:p-6">
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
              <Select
                id="adopt-project"
                className="mt-1.5"
                value={adoptSlug}
                onChange={(event) => setAdoptSlug(event.target.value)}
              >
                <option value="">Select a project</option>
                {adoptableProjects.map((project: ProjectSummary) => (
                  <option key={project.slug} value={project.slug}>
                    {project.display_name} ({project.slug})
                  </option>
                ))}
              </Select>
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
              <Input
                id="adopt-keep-password"
                type="password"
                autoComplete="off"
                value={keepPassword}
                className="mt-1.5"
                onChange={(event) => setKeepPassword(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-sm">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                checked={writeDatabaseUrl}
                onChange={(event) => setWriteDatabaseUrl(event.target.checked)}
              />
              Write DATABASE_URL into the project .env
            </label>
            <span
              role="img"
              aria-label="About the database variables"
              tabIndex={0}
              title="The panel always writes POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER and POSTGRES_PASSWORD to .env. DATABASE_URL is a single combined connection string. Tick this box only if your app reads DATABASE_URL."
              className="flex shrink-0 cursor-help items-center"
            >
              <Info weight="regular" aria-hidden className="size-4 text-muted-foreground" />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="min-h-11"
              disabled={
                !adoptSlug ||
                adoptMutation.isPending ||
                (passwordMode === 'keep' && keepPassword.trim() === '')
              }
              onClick={submitAdopt}
            >
              Adopt database
            </Button>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setAdoptTarget(null)}>
              Cancel
            </Button>
          </div>
          </Card>
        </section>
      ) : null}

      {dropTarget ? (
        <section ref={dropPanelRef} aria-labelledby="drop-heading">
          <Card className="space-y-4 border-destructive/40 p-4 sm:p-6">
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
            <Input
              id={dropConfirmInputId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              disabled={dropMutation.isPending}
              value={dropConfirmText}
              mono
              className="mt-1.5"
              onChange={(event) => setDropConfirmText(event.target.value)}
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox
              checked={dropRole}
              disabled={dropMutation.isPending}
              onChange={(event) => setDropRole(event.target.checked)}
            />
            Also drop the database role
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="danger"
              className="min-h-11 bg-destructive text-foreground hover:bg-destructive/90"
              disabled={!canDrop}
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
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                setDropTarget(null)
                setDropConfirmText('')
                setDropRole(false)
              }}
            >
              Cancel
            </Button>
          </div>
          </Card>
        </section>
      ) : null}

      {databasesQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load databases.
        </p>
      ) : (
        <section className="space-y-3" aria-labelledby="databases-heading">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="databases-heading" className="text-sm font-semibold">
              Databases
            </h2>
            {rows.length > 0 ? (
              <p className="text-sm text-muted-foreground">{databaseSummary(rows)}</p>
            ) : null}
          </div>
          <TableContainer>
            <Table className="min-w-[720px]">
              <THead>
                <TR className="border-b border-border bg-muted/40 hover:bg-muted/40">
                  <TH scope="col" className="font-medium normal-case tracking-normal">
                    Name
                  </TH>
                  <TH scope="col" className="font-medium normal-case tracking-normal">
                    Owner
                  </TH>
                  <TH scope="col" className="font-medium normal-case tracking-normal">
                    Size
                  </TH>
                  <TH scope="col" className="font-medium normal-case tracking-normal">
                    Project
                  </TH>
                  <TH scope="col" className="text-right font-medium normal-case tracking-normal">
                    Actions
                  </TH>
                </TR>
              </THead>
              <TBody className="divide-y divide-border">
                {databasesQuery.isPending ? (
                  <TableSkeletonRows columns={5} rows={4} />
                ) : rows.length === 0 ? (
                  <TR className="hover:bg-transparent">
                    <TD colSpan={5}>
                      <EmptyState
                        icon={<Database weight="regular" className="size-8" aria-hidden />}
                        title="No databases yet."
                      />
                    </TD>
                  </TR>
                ) : (
                  rows.map((row) => (
                    <TR key={row.name}>
                      <TD className="font-mono font-medium">{row.name}</TD>
                      <TD className="font-mono text-muted-foreground">{row.owner}</TD>
                      <TD className="text-right tabular-nums">{formatBytes(row.size_bytes)}</TD>
                      <TD>
                        {row.attached_slug ? (
                          <Link
                            to={`/projects/${encodeURIComponent(row.attached_slug)}`}
                            className="font-medium text-accent hover:underline"
                          >
                            {row.attached_slug}
                          </Link>
                        ) : (
                          <Badge tone="warning" dot>
                            Unattached
                          </Badge>
                        )}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!row.attached_slug ? (
                            <Button
                              variant="secondary"
                              className="min-h-11"
                              onClick={() => {
                                setAdoptTarget(row)
                                setAdoptSlug('')
                                setPasswordMode('rotate')
                                setKeepPassword('')
                                setWriteDatabaseUrl(true)
                              }}
                            >
                              Adopt
                            </Button>
                          ) : null}
                          {row.attached_slug ? (
                            <Button
                              variant="secondary"
                              className="min-h-11"
                              disabled={rotateMutation.isPending}
                              onClick={() => rotateMutation.mutate(row.attached_slug!)}
                            >
                              Rotate password
                            </Button>
                          ) : null}
                          <Button
                            variant="danger"
                            className="min-h-11"
                            onClick={() => {
                              setDropTarget(row)
                              setDropConfirmText('')
                              setDropRole(false)
                            }}
                          >
                            Drop
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableContainer>
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
              <Card key={slug} className="overflow-hidden p-0">
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
                          {formatBytes(dump.size_bytes)} ·{' '}
                          <time dateTime={dump.created_at} title={formatDateTime(dump.created_at)}>
                            {formatRelativeTime(dump.created_at, nowMs)}
                          </time>
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
              </Card>
            )
          })}
        </section>
      ) : null}

      <Card className="overflow-hidden p-0" aria-labelledby="restore-heading">
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
              <Alert tone="warning" title="Before you restore">
                If the cluster already has data, project containers that use it are stopped and
                a safety dump is taken first. Nothing is overwritten until you confirm.
              </Alert>
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
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4 min-h-11"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </Button>
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
                  <Button type="button" variant="secondary" className="min-h-11" onClick={cancelUpload}>
                    <Trash weight="regular" aria-hidden className="size-4" />
                    Cancel upload
                  </Button>
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
            <Button
              variant="danger"
              className="min-h-11 bg-destructive text-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDialogKey((value) => value + 1)
                setConfirmOpen(true)
              }}
            >
              Restore from dump
            </Button>
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
      </Card>

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

      <ConfirmDialog
        open={deployPromptSlug !== null}
        title="Deploy to apply the new password"
        description="The database password is already changed. Deploy so the running containers use it."
        confirmLabel="Deploy"
        cancelLabel="Not now"
        tone="default"
        busy={applyDeployMutation.isPending}
        error={deployError}
        onConfirm={() => {
          if (deployPromptSlug) {
            applyDeployMutation.mutate(deployPromptSlug)
          }
        }}
        onCancel={() => {
          setActionMessage(
            'Password rotated. The running containers keep the old password until you deploy.',
          )
          setDeployPromptSlug(null)
          setDeployError(null)
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
