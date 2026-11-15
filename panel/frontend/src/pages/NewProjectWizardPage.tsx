import { Info, Plus, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CreationChecklist } from '../components/projects/CreationChecklist'
import { ProjectDeleteSection } from '../components/projects/ProjectDeleteSection'
import { PortsConfirmSection } from '../components/projects/PortsConfirmSection'
import { EnvEditor, syncLockedEnvRows } from '../components/projects/EnvEditor'
import { ProjectWizardStepper, type WizardStepId } from '../components/projects/ProjectWizardStepper'
import { RouteEditor } from '../components/projects/RouteEditor'
import { ServiceMappingEditor } from '../components/projects/ServiceMappingEditor'
import type { EnvRow } from '../lib/envEditorUtils'
import { fetchDomains } from '../lib/domainsApi'
import type { RouteDraft, RoutesValidationResult } from '../lib/routeValidation'
import {
  validateBranch,
  validateDockerHubRepo,
  validateRepoUrl,
  isSshRepoUrl,
} from '../lib/projectWizardValidation'
import {
  createProject,
  deleteProject,
  fetchAdoptableDatabases,
  fetchDeployKeyPublic,
  fetchProject,
  fetchProjectTags,
  retryProjectCreate,
  startProjectDeploy,
  testProjectAccess,
  type ProjectHostname,
} from '../lib/projectsApi'
import type { RegistryTagOption } from '../lib/projectDeployTypes'
import { slugFromName, validateProjectSlug } from '../lib/slugFromName'
import {
  prepareServiceMappingRows,
  validateServiceMappingRows,
  type ServiceMappingRow,
} from '../lib/serviceMappingUtils'
import { buildFqdn, validateSubdomain } from '../lib/subdomainValidation'
import { Button, Card, Checkbox, Input, Select, Spinner } from '../components/ui'
import { ApiError, apiErrorDetail, isStepUpRequired } from '../lib/api'

const DEPLOY_NOW_START_TIMEOUT_MS = 1500

const STEP_ORDER: WizardStepId[] = [
  'basics',
  'source',
  'domain',
  'database',
  'environment',
  'review',
  'progress',
]

function defaultDbName(slug: string): string {
  return slug.replace(/-/g, '_')
}

function defaultDbUser(dbName: string): string {
  return `${dbName}_user`
}

function defaultRegistryTags(
  services: { image_env_var: string; tags: RegistryTagOption[] | string[] }[],
): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const svc of services) {
    const first = svc.tags[0]
    if (typeof first === 'string') {
      tags[svc.image_env_var] = first
    } else if (first?.name) {
      tags[svc.image_env_var] = first.name
    }
  }
  return tags
}

export function NewProjectWizardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const retrySlug = searchParams.get('slug')

  const [step, setStep] = useState<WizardStepId>('basics')
  const [displayName, setDisplayName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [composeFile, setComposeFile] = useState('docker-compose.yml')
  const [deployMode, setDeployMode] = useState<'image' | 'build'>('image')
  const [dockerHubRepo, setDockerHubRepo] = useState('')
  const [primaryDomain, setPrimaryDomain] = useState('')
  const [primarySubdomain, setPrimarySubdomain] = useState('')
  const [extraHostnames, setExtraHostnames] = useState<
    { domain: string; subdomain: string; kind: 'alias' | 'redirect' }[]
  >([])
  const [routes, setRoutes] = useState<RouteDraft[]>([
    { path_prefix: '/', port_env_var: '' },
  ])
  const [routesValidation, setRoutesValidation] = useState<RoutesValidationResult>({
    ok: false,
    error: 'At least one route is required.',
  })
  const [databaseMode, setDatabaseMode] = useState<'none' | 'new' | 'adopted'>('none')
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [adoptedDbName, setAdoptedDbName] = useState('')
  const [writeDatabaseUrl, setWriteDatabaseUrl] = useState(false)
  const [migrationService, setMigrationService] = useState('')
  const [migrationCommand, setMigrationCommand] = useState('')
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [userEnv, setUserEnv] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [continueError, setContinueError] = useState<string | null>(null)
  const [activeCreationSlug, setActiveCreationSlug] = useState<string | null>(retrySlug)
  const watchingCreation = useRef(false)
  const [testAccessMessage, setTestAccessMessage] = useState<string | null>(null)
  const [serviceRows, setServiceRows] = useState<ServiceMappingRow[]>([])
  const [deployNowPending, setDeployNowPending] = useState(false)
  const [deployNowError, setDeployNowError] = useState<string | null>(null)

  const wizardDirty = useMemo(
    () =>
      displayName.trim() !== '' ||
      repoUrl.trim() !== '' ||
      userEnv.trim() !== '' ||
      slugTouched,
    [displayName, repoUrl, userEnv, slugTouched],
  )
  useUnsavedChangesWarning(wizardDirty)

  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    refetchIntervalInBackground: false,
  })

  const databasesQuery = useQuery({
    queryKey: ['databases', 'adoptable'],
    queryFn: fetchAdoptableDatabases,
    enabled: databaseMode === 'adopted',
    refetchIntervalInBackground: false,
  })

  const existingProjectQuery = useQuery({
    queryKey: ['projects', retrySlug],
    queryFn: () => fetchProject(retrySlug!),
    enabled: retrySlug !== null && retrySlug !== '',
    refetchIntervalInBackground: false,
  })

  const creationPollQuery = useQuery({
    queryKey: ['projects', activeCreationSlug, 'creation'],
    queryFn: () => fetchProject(activeCreationSlug!),
    enabled: step === 'progress' && activeCreationSlug !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.creation_state.status
      if (status === 'ready' || status === 'failed') {
        watchingCreation.current = false
      }
      if (status === 'running' || watchingCreation.current) {
        return 2000
      }
      return false
    },
    refetchIntervalInBackground: false,
  })

  const deployKeyQuery = useQuery({
    queryKey: ['projects', activeCreationSlug, 'deploy-key'],
    queryFn: () => fetchDeployKeyPublic(activeCreationSlug!),
    enabled:
      step === 'progress' &&
      activeCreationSlug !== null &&
      isSshRepoUrl(repoUrl),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  })

  const existingProject = existingProjectQuery.data
  const [hydratedRetrySlug, setHydratedRetrySlug] = useState<string | null>(null)
  const hydratingExisting =
    existingProject !== undefined && retrySlug !== null && hydratedRetrySlug !== existingProject.slug
  if (hydratingExisting && existingProject) {
    setHydratedRetrySlug(existingProject.slug)
    setDisplayName(existingProject.display_name)
    setSlug(existingProject.slug)
    setSlugTouched(true)
    setRepoUrl(existingProject.repo_url)
    setBranch(existingProject.branch)
    setComposeFile(existingProject.compose_file)
    setDeployMode(existingProject.deploy_mode)
    setDockerHubRepo(existingProject.docker_hub_repo ?? '')
    setDatabaseMode(existingProject.database_mode)
    setDbName(existingProject.db_name ?? defaultDbName(existingProject.slug))
    setDbUser(
      existingProject.db_user ??
        defaultDbUser(existingProject.db_name ?? defaultDbName(existingProject.slug)),
    )
    setWriteDatabaseUrl(existingProject.write_database_url)
    setActiveCreationSlug(existingProject.slug)
    const status = existingProject.creation_state.status
    if (status === 'running' || status === 'failed' || status === 'awaiting_deploy_key' || status === 'awaiting_ports') {
      setStep('progress')
    }
  }

  const [slugDerivedFrom, setSlugDerivedFrom] = useState<string | null>(null)
  if (!slugTouched && !hydratingExisting && displayName.trim() && slugDerivedFrom !== displayName) {
    setSlugDerivedFrom(displayName)
    const derived = slugFromName(displayName)
    if (derived.ok) {
      setSlug(derived.slug)
    } else if (derived.error === 'reserved slug') {
      setSlug('panel')
    } else {
      setSlug(
        displayName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      )
    }
  }

  const dbSyncKey = `${databaseMode}\0${slug}`
  const [appliedDbSyncKey, setAppliedDbSyncKey] = useState<string | null>(null)
    if (appliedDbSyncKey !== dbSyncKey) {
      setAppliedDbSyncKey(dbSyncKey)
      if (databaseMode === 'new' && slug) {
        const name = defaultDbName(slug)
        setDbName(name)
        setDbUser(defaultDbUser(name))
      }
      setWriteDatabaseUrl(false)
    }

  const routePortEnvVars = useMemo(
    () => routes.map((r) => r.port_env_var).filter(Boolean),
    [routes],
  )

  const resolvedDbName =
    databaseMode === 'adopted' ? adoptedDbName : databaseMode === 'new' ? dbName : ''
  const resolvedDbUser =
    databaseMode === 'adopted'
      ? (databasesQuery.data?.find((d) => d.name === adoptedDbName)?.owner ?? dbUser)
      : dbUser
  const envSyncKey = JSON.stringify({
    databaseMode,
    resolvedDbName,
    resolvedDbUser,
    routePortEnvVars,
    writeDatabaseUrl,
  })
  const [appliedEnvSyncKey, setAppliedEnvSyncKey] = useState<string | null>(null)
  if (appliedEnvSyncKey !== envSyncKey) {
    setAppliedEnvSyncKey(envSyncKey)
    setEnvRows((prev) =>
      syncLockedEnvRows(
        prev,
        databaseMode,
        resolvedDbName,
        resolvedDbUser,
        routePortEnvVars,
        writeDatabaseUrl,
      ),
    )
  }

  const slugValidation = validateProjectSlug(slug)
  const basicsValid =
    displayName.trim().length > 0 && slugValidation.ok
  const sourceValid =
    validateRepoUrl(repoUrl) &&
    validateBranch(branch) &&
    composeFile.trim().length > 0 &&
    (deployMode === 'build' || validateDockerHubRepo(dockerHubRepo)) &&
    (deployMode === 'build' || validateServiceMappingRows(serviceRows))

  const primarySubdomainResult = validateSubdomain(primarySubdomain)
  const domainValid =
    primaryDomain !== '' &&
    primarySubdomainResult.ok &&
    routesValidation.ok &&
    extraHostnames.every((row) => {
      const sub = validateSubdomain(row.subdomain)
      return row.domain !== '' && sub.ok
    })

  const databaseValid =
    databaseMode === 'none' ||
    (databaseMode === 'new' && dbName.trim() !== '' && dbUser.trim() !== '') ||
    (databaseMode === 'adopted' && adoptedDbName !== '')

  const envValid = envRows.every((row) => {
    if (row.locked) {
      return true
    }
    return /^[A-Z_][A-Z0-9_]*$/.test(row.key)
  })

  const stepValid: Record<WizardStepId, boolean> = {
    basics: basicsValid,
    source: sourceValid,
    domain: domainValid,
    database: databaseValid,
    environment: envValid,
    review: true,
    progress: true,
  }

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (result) => {
      setCreateError(null)
      setActiveCreationSlug(result.slug)
      setStep('progress')
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setCreateError('A project with this slug already exists.')
      } else {
        setCreateError('Could not start project creation.')
      }
    },
  })

  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDelete = useCallback(
    async (payload: Parameters<typeof deleteProject>[1]) => {
      const target = activeCreationSlug
      if (!target) {
        return
      }
      setDeleteBusy(true)
      setDeleteError(null)
      try {
        await deleteProject(target, payload)
        await queryClient.invalidateQueries({ queryKey: ['projects'] })
        navigate('/projects')
      } catch (error) {
        if (isStepUpRequired(error)) {
          throw error
        }
        setDeleteError(error instanceof ApiError ? 'Delete failed.' : 'Delete failed.')
      } finally {
        setDeleteBusy(false)
      }
    },
    [activeCreationSlug, navigate, queryClient],
  )

  const retryMutation = useMutation({
    mutationFn: retryProjectCreate,
    onSuccess: () => {
      setContinueError(null)
      watchingCreation.current = true
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void creationPollQuery.refetch()
    },
    onError: (error: unknown) => {
      watchingCreation.current = false
      const detail =
        error instanceof ApiError &&
        error.body &&
        typeof error.body === 'object' &&
        'detail' in error.body &&
        typeof error.body.detail === 'string'
          ? error.body.detail
          : null
      setContinueError(detail ?? 'Repository access failed. Add the deploy key, then continue.')
    },
  })

  const testAccessMutation = useMutation({
    mutationFn: testProjectAccess,
    onSuccess: () => {
      setTestAccessMessage('Repository access succeeded.')
    },
    onError: () => {
      setTestAccessMessage('Repository access failed.')
    },
  })

  const hostnames = useMemo((): ProjectHostname[] => {
    const list: ProjectHostname[] = [
      {
        domain: primaryDomain,
        subdomain: primarySubdomainResult.ok ? primarySubdomainResult.normalized : '',
        kind: 'primary',
      },
    ]
    for (const extra of extraHostnames) {
      const sub = validateSubdomain(extra.subdomain)
      list.push({
        domain: extra.domain,
        subdomain: sub.ok ? sub.normalized : extra.subdomain,
        kind: extra.kind,
      })
    }
    return list
  }, [primaryDomain, primarySubdomain, primarySubdomainResult, extraHostnames])

  const handleCreate = useCallback(() => {
    const resolvedDbName =
      databaseMode === 'adopted'
        ? adoptedDbName
        : databaseMode === 'new'
          ? dbName
          : null
    const adopted = databasesQuery.data?.find((d) => d.name === adoptedDbName)
    const resolvedDbUser =
      databaseMode === 'adopted'
        ? adopted?.owner ?? dbUser
        : databaseMode === 'new'
          ? dbUser
          : null

    const preparedServices =
      deployMode === 'image' ? prepareServiceMappingRows(serviceRows) : { ok: true as const, rows: [] }
    if (!preparedServices.ok) {
      return
    }

    createMutation.mutate({
      slug,
      display_name: displayName.trim(),
      repo: repoUrl.trim(),
      branch: branch.trim(),
      compose_file: composeFile.trim(),
      deploy_mode: deployMode,
      docker_hub_repo: deployMode === 'image' ? dockerHubRepo.trim() : null,
      database_mode: databaseMode,
      db_name: resolvedDbName,
      db_user: resolvedDbUser,
      write_database_url: databaseMode !== 'none' && writeDatabaseUrl,
      user_env: userEnv || null,
      migration_service: migrationService.trim() || null,
      migration_command: migrationCommand.trim() || null,
      hostnames,
      routes: routes.map((r) => ({
        path_prefix: r.path_prefix,
        port_env_var: r.port_env_var,
        streaming: r.streaming ?? false,
        websocket: r.websocket ?? false,
        pass_authorization: r.pass_authorization ?? false,
        max_body_mb: r.max_body_mb ?? 25,
        read_timeout_s: r.read_timeout_s ?? 60,
        send_timeout_s: r.send_timeout_s ?? 60,
      })),
      services: preparedServices.rows,
    })
  }, [
    adoptedDbName,
    branch,
    composeFile,
    createMutation,
    databaseMode,
    databasesQuery.data,
    dbName,
    dbUser,
    deployMode,
    displayName,
    dockerHubRepo,
    hostnames,
    migrationCommand,
    migrationService,
    repoUrl,
    routes,
    slug,
    userEnv,
    writeDatabaseUrl,
    serviceRows,
  ])

  function goBack() {
    const index = STEP_ORDER.indexOf(step)
    if (index > 0) {
      setStep(STEP_ORDER[index - 1]!)
    }
  }

  function goContinue() {
    if (!stepValid[step]) {
      return
    }
    const index = STEP_ORDER.indexOf(step)
    if (index < STEP_ORDER.length - 2) {
      setStep(STEP_ORDER[index + 1]!)
    }
  }

  const handleDeployNow = useCallback(async () => {
    const target = activeCreationSlug ?? slug
    if (!target || deployNowPending) {
      return
    }
    setDeployNowPending(true)
    setDeployNowError(null)
    const projectPath = `/projects/${encodeURIComponent(target)}#deploy`

    let deployPromise: Promise<{ id: number; status: string }> | null = null
    try {
      const project = await fetchProject(target)
      if (project.deploy_mode === 'build') {
        deployPromise = startProjectDeploy(target, { build: true, run_migrations: true })
      } else {
        const tagsData = await fetchProjectTags(target)
        const tags = defaultRegistryTags(tagsData.services)
        if (Object.keys(tags).length > 0) {
          deployPromise = startProjectDeploy(target, { tags, run_migrations: true })
        }
      }
    } catch {
      setDeployNowPending(false)
      navigate(projectPath)
      return
    }

    if (!deployPromise) {
      setDeployNowPending(false)
      navigate(projectPath)
      return
    }

    let deployStartTimeoutId: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      deployPromise.then(
        () => ({ kind: 'fulfilled' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      ),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        deployStartTimeoutId = setTimeout(
          () => resolve({ kind: 'timeout' }),
          DEPLOY_NOW_START_TIMEOUT_MS,
        )
      }),
    ])
    clearTimeout(deployStartTimeoutId)

    setDeployNowPending(false)

    if (outcome.kind === 'rejected') {
      const detail = apiErrorDetail(outcome.error)
      setDeployNowError(detail || 'Could not start the deploy.')
      return
    }

    navigate(projectPath)
  }, [activeCreationSlug, slug, deployNowPending, navigate])

  const creationState = creationPollQuery.data?.creation_state
  const publicKey =
    deployKeyQuery.data?.public_key ?? creationState?.public_key ?? null

  const registeredProject = existingProjectQuery.data
  const canTestAccess = registeredProject !== undefined

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 ${step === 'environment' ? 'max-w-6xl' : 'max-w-3xl'}`}
    >
      <div className="space-y-1">
        <Link
          to="/projects"
          className="text-sm font-medium underline-offset-2 hover:underline cursor-pointer text-accent"
        >
          ← Projects
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">New project</h1>
      </div>

      {step !== 'progress' ? <ProjectWizardStepper active={step} /> : null}

      {step === 'basics' ? (
        <Card className="space-y-4 p-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="display-name">
              Display name
            </label>
            <Input
              id="display-name"
              className="mt-1"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="project-slug">
              Slug
            </label>
            <Input
              id="project-slug"
              mono
                  className="mt-1"
              value={slug}
              aria-invalid={slugValidation.ok ? undefined : true}
              aria-describedby={slugValidation.ok ? undefined : 'slug-error'}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
            />
            {!slugValidation.ok ? (
              <p id="slug-error" className="mt-1 text-sm text-destructive" role="alert">
                {slugValidation.error}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {step === 'source' ? (
        <Card className="space-y-4 p-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="repo-url">
              Repository URL
            </label>
            <Input
              id="repo-url"
              placeholder="git@github.com:owner/name.git"
              mono
                  className="mt-1"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              A private repository must use an SSH URL, such as{' '}
              <span className="font-mono text-foreground">git@github.com:owner/name.git</span>.
              An https URL cannot use the deploy key. Creation stops after the key is created so
              you can add it under Settings → Deploy keys before the repository is cloned.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="branch">
                Branch
              </label>
              <Input
                id="branch"
                className="mt-1"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="compose-file">
                Compose file
              </label>
              <Input
                id="compose-file"
                className="mt-1"
                value={composeFile}
                onChange={(e) => setComposeFile(e.target.value)}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Deploy mode</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="deploy-mode"
                checked={deployMode === 'image'}
                onChange={() => setDeployMode('image')}
              />
              Pull image (Docker Hub)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="deploy-mode"
                checked={deployMode === 'build'}
                onChange={() => setDeployMode('build')}
              />
              Build from repository
            </label>
          </fieldset>
          {deployMode === 'image' ? (
            <>
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="docker-hub">
                  Docker Hub repository
                </label>
                <Input
                  id="docker-hub"
                  placeholder="namespace/name"
                  mono
                  className="mt-1"
                  value={dockerHubRepo}
                  onChange={(e) => setDockerHubRepo(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Leave the list empty to detect services from the compose file after clone, or
                  fill service name, <span className="font-mono">DOCKER_IMAGE_*</span> variable,
                  and tag prefix yourself.
                </p>
                <ServiceMappingEditor services={serviceRows} onChange={setServiceRows} />
              </div>
            </>
          ) : null}
          {isSshRepoUrl(repoUrl) ? (
            <div className="rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
              {publicKey ? (
                <>
                  <p>
                    Add this read-only deploy key under the repo&apos;s Settings → Deploy keys.
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
                    {publicKey}
                  </pre>
                </>
              ) : (
                <p>
                  A read-only deploy key for this project is generated at the end of setup — the
                  progress screen will show it. Add it under the repo&apos;s Settings → Deploy
                  keys, then continue.
                </p>
              )}
            </div>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={!canTestAccess || testAccessMutation.isPending}
            loading={testAccessMutation.isPending}
            onClick={() => {
              if (registeredProject) {
                testAccessMutation.mutate(registeredProject.slug)
              }
            }}
          >
            {canTestAccess
              ? 'Test access'
              : 'Test access is available after the project is registered'}
          </Button>
          {testAccessMessage ? (
            <p className="text-sm text-muted-foreground">{testAccessMessage}</p>
          ) : null}
        </Card>
      ) : null}

      {step === 'domain' ? (
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="primary-domain">
                Primary domain
              </label>
              <Select
                id="primary-domain"
                className="mt-1"
                value={primaryDomain}
                onChange={(e) => setPrimaryDomain(e.target.value)}
              >
                <option value="">Select domain</option>
                {(domainsQuery.data ?? []).map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="primary-subdomain">
                Subdomain
              </label>
              <Input
                id="primary-subdomain"
                placeholder="empty for root"
                className="mt-1"
                value={primarySubdomain}
                aria-invalid={primarySubdomainResult.ok ? undefined : true}
                aria-describedby={primarySubdomainResult.ok ? undefined : 'primary-subdomain-error'}
                onChange={(e) => setPrimarySubdomain(e.target.value)}
              />
              {!primarySubdomainResult.ok ? (
                <p id="primary-subdomain-error" className="mt-1 text-sm text-destructive" role="alert">
                  {primarySubdomainResult.error}
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Primary hostname:{' '}
            <span className="font-mono text-foreground">
              {primaryDomain
                ? buildFqdn(primaryDomain, primarySubdomainResult.ok ? primarySubdomainResult.normalized : '')
                : '—'}
            </span>
          </p>
          <RouteEditor
            routes={routes}
            onChange={setRoutes}
            onValidationChange={setRoutesValidation}
          />
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-medium">Extra hostnames</p>
            <p className="text-sm text-muted-foreground">
              Optional names for this same site. An alias serves it there, such as{' '}
              <span className="font-mono text-foreground">www.example.com</span>. A redirect sends
              visitors to the primary hostname.
            </p>
            {extraHostnames.map((row, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.8fr)_auto_auto] sm:items-center">
                <Select
                  aria-label={`Extra domain ${index + 1}`}
                  value={row.domain}
                  onChange={(e) =>
                    setExtraHostnames((list) =>
                      list.map((item, i) =>
                        i === index ? { ...item, domain: e.target.value } : item,
                      ),
                    )
                  }
                >
                  <option value="">Domain</option>
                  {(domainsQuery.data ?? []).map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Extra subdomain ${index + 1}`}
                  placeholder="subdomain"
                  value={row.subdomain}
                  onChange={(e) =>
                    setExtraHostnames((list) =>
                      list.map((item, i) =>
                        i === index ? { ...item, subdomain: e.target.value } : item,
                      ),
                    )
                  }
                />
                <Select
                  aria-label={`Extra kind ${index + 1}`}
                  value={row.kind}
                  onChange={(e) =>
                    setExtraHostnames((list) =>
                      list.map((item, i) =>
                        i === index
                          ? { ...item, kind: e.target.value as 'alias' | 'redirect' }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="alias">Alias</option>
                  <option value="redirect">Redirect</option>
                </Select>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="h-10"
                  leftIcon={<Trash weight="regular" aria-hidden className="size-4" />}
                  onClick={() =>
                    setExtraHostnames((list) => list.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}
              onClick={() =>
                setExtraHostnames((list) => [
                  ...list,
                  { domain: primaryDomain, subdomain: '', kind: 'alias' },
                ])
              }
            >
              Add hostname
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'database' ? (
        <Card className="space-y-4 p-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Database</legend>
            {(['none', 'new', 'adopted'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm capitalize">
                <input
                  type="radio"
                  name="database-mode"
                  checked={databaseMode === mode}
                  onChange={() => setDatabaseMode(mode)}
                />
                {mode === 'none' ? 'No database' : mode === 'new' ? 'Create new' : 'Adopt existing'}
              </label>
            ))}
          </fieldset>
          {databaseMode === 'new' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="db-name">
                  Database name
                </label>
                <Input
                  id="db-name"
                  mono
                  className="mt-1"
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium" htmlFor="db-user">
                  Database user
                </label>
                <Input
                  id="db-user"
                  mono
                  className="mt-1"
                  value={dbUser}
                  onChange={(e) => setDbUser(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          {databaseMode === 'adopted' ? (
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="adopt-db">
                Unattached database
              </label>
              <Select
                id="adopt-db"
                className="mt-1"
                value={adoptedDbName}
                onChange={(e) => setAdoptedDbName(e.target.value)}
              >
                <option value="">Select database</option>
                {(databasesQuery.data ?? []).map((db) => (
                  <option key={db.name} value={db.name}>
                    {db.name} ({db.owner})
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {databaseMode !== 'none' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  The panel always writes these connection variables. Check the box only if the
                  app reads <span className="font-mono text-foreground">DATABASE_URL</span>.
                </p>
                <ul className="flex flex-wrap gap-2">
                  {[
                    'POSTGRES_HOST',
                    'POSTGRES_PORT',
                    'POSTGRES_DB',
                    'POSTGRES_USER',
                    'POSTGRES_PASSWORD',
                  ].map((name) => (
                    <li
                      key={name}
                      className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={writeDatabaseUrl}
                    onChange={(e) => setWriteDatabaseUrl(e.target.checked)}
                  />
                  Write DATABASE_URL to .env
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
            </div>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="migration-service" className="block text-sm font-medium">
              Migration service (optional)
            </label>
            <Input
              id="migration-service"
              type="text"
              value={migrationService}
              placeholder="backend"
              className="mt-1"
              onChange={(e) => setMigrationService(e.target.value)}
            />
            <label htmlFor="migration-command" className="block text-sm font-medium">
              Migration command (optional)
            </label>
            <Input
              id="migration-command"
              type="text"
              value={migrationCommand}
              placeholder="bash /app/run_migrations.sh"
              mono
                  className="mt-1"
              onChange={(e) => setMigrationCommand(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Runs inside the service container on every deploy (before containers
              switch), e.g. <span className="font-mono">bash /app/run_migrations.sh</span>{' '}
              or <span className="font-mono">alembic upgrade head</span>. Both fields
              must be set to enable.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Projects using Postgres must join the external <code>postgres-net</code> network in
            their compose file.
          </p>
        </Card>
      ) : null}

      {step === 'environment' ? (
        <Card className="p-4">
          <EnvEditor
            rows={envRows}
            routePortEnvVars={routePortEnvVars}
            onChange={(rows, env) => {
              setEnvRows(rows)
              setUserEnv(env)
            }}
          />
        </Card>
      ) : null}

      {step === 'review' ? (
        <Card className="space-y-3 p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Directory:</span>{' '}
            <span className="font-mono">/srv/apps/{slug}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Database:</span> {databaseMode}
          </p>
          <ul className="list-inside list-disc space-y-1">
            {hostnames.map((h) => (
              <li key={`${h.kind}-${h.domain}-${h.subdomain}`} className="font-mono">
                {buildFqdn(h.domain, h.subdomain)} ({h.kind})
              </li>
            ))}
          </ul>
          <ul className="list-inside list-disc space-y-1 font-mono">
            {routes.map((r) => (
              <li key={r.path_prefix}>
                {r.path_prefix} → {r.port_env_var}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">Environment keys:</p>
          <ul className="list-inside list-disc font-mono">
            {envRows.map((row) => (
              <li key={row.key}>{row.key}</li>
            ))}
          </ul>
          {createError ? (
            <p className="text-sm text-destructive" role="alert">{createError}</p>
          ) : null}
        </Card>
      ) : null}

      {step === 'progress' ? (
        <Card className="space-y-4 p-4">
          {creationPollQuery.isPending && !creationState ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Loading creation status…
            </p>
          ) : null}
          {creationState ? (
            <>
              <CreationChecklist
                steps={creationState.steps}
                onRetry={
                  creationState.status === 'failed'
                    ? () => {
                        if (activeCreationSlug) {
                          retryMutation.mutate(activeCreationSlug)
                        }
                      }
                    : undefined
                }
                retryPending={retryMutation.isPending}
              />
              {creationState.status === 'failed' && activeCreationSlug ? (
                <ProjectDeleteSection
                  slug={activeCreationSlug}
                  onDelete={handleDelete}
                  busy={deleteBusy}
                  error={deleteError}
                />
              ) : null}
              {creationState.status === 'awaiting_deploy_key' ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Add this read-only key to the GitHub repo under Settings → Deploy keys, then
                    continue.
                  </p>
                  {publicKey ? (
                    <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
                      {publicKey}
                    </pre>
                  ) : (
                    <p className="text-muted-foreground">Loading the deploy key…</p>
                  )}
                  {continueError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {continueError}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    disabled={retryMutation.isPending || !publicKey}
                    loading={retryMutation.isPending}
                    onClick={() => {
                      if (activeCreationSlug) {
                        retryMutation.mutate(activeCreationSlug)
                      }
                    }}
                  >
                    {retryMutation.isPending ? 'Checking access…' : 'Continue'}
                  </Button>
                </div>
              ) : null}
              {creationState.status === 'awaiting_ports' && activeCreationSlug ? (
                <PortsConfirmSection
                  slug={activeCreationSlug}
                  portChoices={creationState.port_choices ?? {}}
                  onConfirmed={() => {
                    watchingCreation.current = true
                    void queryClient.invalidateQueries({
                      queryKey: ['projects', activeCreationSlug],
                    })
                    void creationPollQuery.refetch()
                  }}
                />
              ) : null}
              {creationState.status === 'ready' ? (
                <div className="flex flex-col gap-2">
                  {deployNowError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {deployNowError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      disabled={deployNowPending}
                      loading={deployNowPending}
                      onClick={() => {
                        void handleDeployNow()
                      }}
                    >
                      {deployNowPending ? 'Starting deploy…' : 'Deploy now'}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => navigate(`/projects/${encodeURIComponent(activeCreationSlug ?? slug)}`)}
                    >
                      Open project
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {isSshRepoUrl(repoUrl) && publicKey && creationState?.status !== 'awaiting_deploy_key' ? (
            <div className="text-sm text-muted-foreground">
              <p>Deploy key (read-only):</p>
              <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
                {publicKey}
              </pre>
            </div>
          ) : null}
        </Card>
      ) : null}

      {step !== 'progress' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={step === 'basics'}
            onClick={goBack}
          >
            Back
          </Button>
          {step === 'review' ? (
            <Button
              type="button"
              disabled={createMutation.isPending}
              loading={createMutation.isPending}
              onClick={handleCreate}
            >
              {createMutation.isPending ? 'Creating…' : 'Create project'}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!stepValid[step]}
              onClick={goContinue}
            >
              Continue
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
