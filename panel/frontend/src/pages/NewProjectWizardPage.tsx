import { Spinner } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CreationChecklist } from '../components/projects/CreationChecklist'
import { EnvEditor, syncLockedEnvRows } from '../components/projects/EnvEditor'
import { ProjectWizardStepper, type WizardStepId } from '../components/projects/ProjectWizardStepper'
import { RouteEditor } from '../components/projects/RouteEditor'
import { ServiceMappingEditor } from '../components/projects/ServiceMappingEditor'
import type { EnvRow } from '../lib/envEditorUtils'
import { fetchDomains } from '../lib/domainsApi'
import type { RoutesValidationResult } from '../lib/routeValidation'
import {
  validateBranch,
  validateDockerHubRepo,
  validateRepoUrl,
  isSshRepoUrl,
} from '../lib/projectWizardValidation'
import {
  createProject,
  fetchAdoptableDatabases,
  fetchDeployKeyPublic,
  fetchProject,
  retryProjectCreate,
  testProjectAccess,
  type ProjectHostname,
} from '../lib/projectsApi'
import { slugFromName, validateProjectSlug } from '../lib/slugFromName'
import {
  prepareServiceMappingRows,
  validateServiceMappingRows,
  type ServiceMappingRow,
} from '../lib/serviceMappingUtils'
import { buildFqdn, validateSubdomain } from '../lib/subdomainValidation'
import { ApiError } from '../lib/api'

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
  const [routes, setRoutes] = useState([{ path_prefix: '/', port_env_var: '' }])
  const [routesValidation, setRoutesValidation] = useState<RoutesValidationResult>({
    ok: false,
    error: 'At least one route is required.',
  })
  const [databaseMode, setDatabaseMode] = useState<'none' | 'new' | 'adopted'>('none')
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [adoptedDbName, setAdoptedDbName] = useState('')
  const [writeDatabaseUrl, setWriteDatabaseUrl] = useState(true)
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [userEnv, setUserEnv] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [activeCreationSlug, setActiveCreationSlug] = useState<string | null>(retrySlug)
  const [testAccessMessage, setTestAccessMessage] = useState<string | null>(null)
  const [serviceRows, setServiceRows] = useState<ServiceMappingRow[]>([])

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
      return status === 'running' ? 2000 : false
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
    if (status === 'running' || status === 'failed') {
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
      setWriteDatabaseUrl(true)
    }
    if (databaseMode === 'none') {
      setWriteDatabaseUrl(false)
    }
    if (databaseMode === 'adopted') {
      setWriteDatabaseUrl(true)
    }
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

  const retryMutation = useMutation({
    mutationFn: retryProjectCreate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void creationPollQuery.refetch()
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
      hostnames,
      routes: routes.map((r) => ({
        path_prefix: r.path_prefix,
        port_env_var: r.port_env_var,
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

  const creationState = creationPollQuery.data?.creation_state
  const publicKey =
    deployKeyQuery.data?.public_key ?? creationState?.public_key ?? null

  const registeredProject = existingProjectQuery.data
  const canTestAccess = registeredProject !== undefined

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="space-y-1">
        <Link to="/projects" className="text-sm text-accent">
          ← Projects
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">New project</h1>
      </div>

      {step !== 'progress' ? <ProjectWizardStepper active={step} /> : null}

      {step === 'basics' ? (
        <section className="space-y-4 rounded-md border border-border bg-card p-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="display-name">
              Display name
            </label>
            <input
              id="display-name"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="project-slug">
              Slug
            </label>
            <input
              id="project-slug"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
            />
            {!slugValidation.ok ? (
              <p className="text-sm text-destructive">{slugValidation.error}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 'source' ? (
        <section className="space-y-4 rounded-md border border-border bg-card p-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="repo-url">
              Repository URL
            </label>
            <input
              id="repo-url"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="branch">
                Branch
              </label>
              <input
                id="branch"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="compose-file">
                Compose file
              </label>
              <input
                id="compose-file"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
                <label className="text-sm font-medium" htmlFor="docker-hub">
                  Docker Hub repository
                </label>
                <input
                  id="docker-hub"
                  placeholder="namespace/name"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
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
              <p>
                Add this read-only deploy key under the repo&apos;s Settings → Deploy keys.
              </p>
              {publicKey ? (
                <pre className="mt-2 overflow-x-auto rounded bg-card p-2 font-mono text-xs text-foreground">
                  {publicKey}
                </pre>
              ) : (
                <p className="mt-2 text-xs">The public key appears after create, not before.</p>
              )}
            </div>
          ) : null}
          <button
            type="button"
            disabled={!canTestAccess || testAccessMutation.isPending}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
            onClick={() => {
              if (registeredProject) {
                testAccessMutation.mutate(registeredProject.slug)
              }
            }}
          >
            {canTestAccess
              ? 'Test access'
              : 'Test access is available after the project is registered'}
          </button>
          {testAccessMessage ? (
            <p className="text-sm text-muted-foreground">{testAccessMessage}</p>
          ) : null}
        </section>
      ) : null}

      {step === 'domain' ? (
        <section className="space-y-4 rounded-md border border-border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="primary-domain">
                Primary domain
              </label>
              <select
                id="primary-domain"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={primaryDomain}
                onChange={(e) => setPrimaryDomain(e.target.value)}
              >
                <option value="">Select domain</option>
                {(domainsQuery.data ?? []).map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="primary-subdomain">
                Subdomain
              </label>
              <input
                id="primary-subdomain"
                placeholder="empty for root"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={primarySubdomain}
                onChange={(e) => setPrimarySubdomain(e.target.value)}
              />
              {!primarySubdomainResult.ok ? (
                <p className="text-sm text-destructive">{primarySubdomainResult.error}</p>
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
            {extraHostnames.map((row, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-4">
                <select
                  aria-label={`Extra domain ${index + 1}`}
                  className="rounded-md border border-border bg-background px-2 py-2 text-sm sm:col-span-2"
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
                </select>
                <input
                  aria-label={`Extra subdomain ${index + 1}`}
                  className="rounded-md border border-border bg-background px-2 py-2 text-sm"
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
                <select
                  aria-label={`Extra kind ${index + 1}`}
                  className="rounded-md border border-border bg-background px-2 py-2 text-sm"
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
                </select>
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-accent cursor-pointer"
              onClick={() =>
                setExtraHostnames((list) => [
                  ...list,
                  { domain: primaryDomain, subdomain: '', kind: 'alias' },
                ])
              }
            >
              Add hostname
            </button>
          </div>
        </section>
      ) : null}

      {step === 'database' ? (
        <section className="space-y-4 rounded-md border border-border bg-card p-4">
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
                <label className="text-sm font-medium" htmlFor="db-name">
                  Database name
                </label>
                <input
                  id="db-name"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="db-user">
                  Database user
                </label>
                <input
                  id="db-user"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                  value={dbUser}
                  onChange={(e) => setDbUser(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          {databaseMode === 'adopted' ? (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="adopt-db">
                Unattached database
              </label>
              <select
                id="adopt-db"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={adoptedDbName}
                onChange={(e) => setAdoptedDbName(e.target.value)}
              >
                <option value="">Select database</option>
                {(databasesQuery.data ?? []).map((db) => (
                  <option key={db.name} value={db.name}>
                    {db.name} ({db.owner})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {databaseMode !== 'none' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={writeDatabaseUrl}
                onChange={(e) => setWriteDatabaseUrl(e.target.checked)}
              />
              Write DATABASE_URL to .env
            </label>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Projects using Postgres must join the external <code>postgres-net</code> network in
            their compose file.
          </p>
        </section>
      ) : null}

      {step === 'environment' ? (
        <section className="rounded-md border border-border bg-card p-4">
          <EnvEditor
            rows={envRows}
            routePortEnvVars={routePortEnvVars}
            onChange={(rows, env) => {
              setEnvRows(rows)
              setUserEnv(env)
            }}
          />
        </section>
      ) : null}

      {step === 'review' ? (
        <section className="space-y-3 rounded-md border border-border bg-card p-4 text-sm">
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
          {createError ? <p className="text-destructive">{createError}</p> : null}
        </section>
      ) : null}

      {step === 'progress' ? (
        <section className="space-y-4 rounded-md border border-border bg-card p-4">
          {creationPollQuery.isPending && !creationState ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
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
              {creationState.status === 'ready' ? (
                <button
                  type="button"
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background cursor-pointer"
                  onClick={() => navigate(`/projects/${encodeURIComponent(activeCreationSlug ?? slug)}`)}
                >
                  Open project
                </button>
              ) : null}
            </>
          ) : null}
          {isSshRepoUrl(repoUrl) && publicKey ? (
            <div className="text-sm text-muted-foreground">
              <p>Deploy key (read-only):</p>
              <pre className="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs">
                {publicKey}
              </pre>
            </div>
          ) : null}
        </section>
      ) : null}

      {step !== 'progress' ? (
        <div className="flex flex-wrap justify-between gap-3">
          <button
            type="button"
            disabled={step === 'basics'}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
            onClick={goBack}
          >
            Back
          </button>
          {step === 'review' ? (
            <button
              type="button"
              disabled={createMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background disabled:opacity-50 cursor-pointer"
              onClick={handleCreate}
            >
              Create project
            </button>
          ) : (
            <button
              type="button"
              disabled={!stepValid[step]}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background disabled:opacity-50 cursor-pointer"
              onClick={goContinue}
            >
              Continue
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
