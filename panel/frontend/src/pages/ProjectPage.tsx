import { Spinner } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ComposeLogsViewer } from '../components/projects/ComposeLogsViewer'
import { EnvEditor } from '../components/projects/EnvEditor'
import { HostnameEditor } from '../components/projects/HostnameEditor'
import { ProjectDeleteSection } from '../components/projects/ProjectDeleteSection'
import { RouteEditor } from '../components/projects/RouteEditor'
import { ServiceMappingEditor } from '../components/projects/ServiceMappingEditor'
import { TagPicker } from '../components/projects/TagPicker'
import { StatusBadge } from '../components/StatusBadge'
import { ApiError, isStepUpRequired } from '../lib/api'
import { composeServiceStatusVariant } from '../lib/composeServiceStatus'
import { fetchContainerMetrics } from '../lib/dashboardApi'
import { fetchDomains } from '../lib/domainsApi'
import type { EnvRow } from '../lib/envEditorUtils'
import { formatBytes } from '../lib/format'
import { entriesToEnvRows, envKeysToPatchUnset, envRowsToPatchSet } from '../lib/projectEnv'
import type { RegistryTagOption } from '../lib/projectDeployTypes'
import {
  prepareServiceMappingRows,
  tagPrefixFromImageEnvVar,
  type ServiceMappingRow,
} from '../lib/serviceMappingUtils'
import {
  deleteProject,
  fetchComposePs,
  fetchComposeServices,
  fetchProject,
  fetchProjectDeploys,
  fetchProjectDumps,
  fetchProjectEnv,
  fetchProjectTags,
  patchProjectEnv,
  patchProjectSettings,
  projectDumpDownloadUrl,
  putProjectRouting,
  putProjectServices,
  redeployDeploy,
  restartProjectCompose,
  rotateProjectDatabase,
  startProjectDeploy,
  type ProjectDetail,
  type ProjectHostname,
  type ProjectRoute,
} from '../lib/projectsApi'
import { buildFqdn } from '../lib/subdomainValidation'
import type { RouteDraft } from '../lib/routeValidation'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'logs', label: 'Logs' },
  { id: 'environment', label: 'Environment' },
  { id: 'routing', label: 'Routing' },
  { id: 'database', label: 'Database' },
  { id: 'settings', label: 'Settings' },
] as const

type TabId = (typeof TABS)[number]['id']

function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#/, '')
  if (TABS.some((tab) => tab.id === id)) {
    return id as TabId
  }
  return 'overview'
}

function normalizeRegistryTags(tags: RegistryTagOption[] | string[]): RegistryTagOption[] {
  return tags.map((tag) =>
    typeof tag === 'string' ? { name: tag, sha: '', pushed_at: null } : tag,
  )
}

function projectPublicUrls(project: ProjectDetail): string[] {
  const urls: string[] = []
  for (const hostname of project.hostnames) {
    if (hostname.kind === 'redirect') {
      continue
    }
    const fqdn = buildFqdn(hostname.domain, hostname.subdomain)
    for (const route of project.routes) {
      urls.push(`https://${fqdn}${route.path_prefix}`)
    }
  }
  return urls
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

export function ProjectPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>(() => tabFromHash(window.location.hash))
  const [logService, setLogService] = useState('')
  const [selectedTags, setSelectedTags] = useState<Record<string, string>>({})
  const [activeDeployId, setActiveDeployId] = useState<number | null>(null)
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [loadedEnvKeys, setLoadedEnvKeys] = useState<string[]>([])
  const [envDirty, setEnvDirty] = useState(false)
  const [restartPrompt, setRestartPrompt] = useState(false)
  const [hostnamesDraft, setHostnamesDraft] = useState<ProjectHostname[]>([])
  const [routesDraft, setRoutesDraft] = useState<RouteDraft[]>([])
  const [routingError, setRoutingError] = useState<string | null>(null)
  const [migrationCommand, setMigrationCommand] = useState('')
  const [migrationService, setMigrationService] = useState('')
  const [healthCheckUrl, setHealthCheckUrl] = useState('')
  const [dbRestartPrompt, setDbRestartPrompt] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [servicesDraft, setServicesDraft] = useState<ServiceMappingRow[]>([])
  const [servicesMappingValid, setServicesMappingValid] = useState(true)
  const [detectComposeError, setDetectComposeError] = useState<string | null>(null)
  const [detectComposeBusy, setDetectComposeBusy] = useState(false)

  useEffect(() => {
    const onHashChange = () => setActiveTab(tabFromHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const selectTab = (tab: TabId) => {
    setActiveTab(tab)
    const nextHash = tab === 'overview' ? '' : `#${tab}`
    window.history.replaceState(null, '', `${window.location.pathname}${nextHash}`)
  }

  const projectQuery = useQuery({
    queryKey: ['project', slug],
    queryFn: () => fetchProject(slug),
    enabled: Boolean(slug),
    refetchIntervalInBackground: false,
  })

  const project = projectQuery.data

  useEffect(() => {
    if (!project) {
      return
    }
    setHostnamesDraft(project.hostnames)
    setRoutesDraft(
      project.routes.map((route) => ({
        path_prefix: route.path_prefix,
        port_env_var: route.port_env_var,
      })),
    )
    setMigrationCommand(project.migration_command ?? '')
    setMigrationService(project.migration_service ?? '')
    setHealthCheckUrl(project.health_check_url ?? '')
    setServicesDraft(
      project.services.map((svc) => ({
        service_name: svc.service_name,
        image_env_var: svc.image_env_var,
        tag_prefix: svc.tag_prefix,
      })),
    )
  }, [project])

  const psQuery = useQuery({
    queryKey: ['project', slug, 'compose-ps'],
    queryFn: () => fetchComposePs(slug),
    enabled: Boolean(slug) && (activeTab === 'overview' || activeTab === 'logs'),
    refetchInterval: activeTab === 'overview' ? 5000 : false,
    refetchIntervalInBackground: false,
  })

  const metricsQuery = useQuery({
    queryKey: ['metrics', 'containers'],
    queryFn: fetchContainerMetrics,
    enabled: activeTab === 'overview',
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })

  const tagsQuery = useQuery({
    queryKey: ['project', slug, 'tags'],
    queryFn: () => fetchProjectTags(slug),
    enabled: Boolean(slug) && activeTab === 'deploy' && project?.deploy_mode === 'image',
    refetchIntervalInBackground: false,
  })

  useEffect(() => {
    if (!tagsQuery.data) {
      return
    }
    setSelectedTags((prev) => {
      const next = { ...prev }
      for (const svc of tagsQuery.data.services) {
        const options = normalizeRegistryTags(svc.tags)
        if (options.length === 0) {
          continue
        }
        if (!next[svc.image_env_var]) {
          next[svc.image_env_var] = options[0]!.name
        }
      }
      return next
    })
  }, [tagsQuery.data])

  const deploysQuery = useQuery({
    queryKey: ['project', slug, 'deploys'],
    queryFn: () => fetchProjectDeploys(slug),
    enabled: Boolean(slug) && activeTab === 'deploy',
    refetchInterval: (query) => {
      if (activeTab !== 'deploy') {
        return false
      }
      if (activeDeployId !== null) {
        return 2000
      }
      const rows = query.state.data
      if (rows?.some((row) => row.status === 'running')) {
        return 2000
      }
      return false
    },
    refetchIntervalInBackground: false,
  })

  const deploys = deploysQuery.data ?? []
  const runningDeploy = deploys.find((row) => row.status === 'running')
  const latestDeploy = deploys[0]
  const latestSucceeded = deploys.find((row) => row.status === 'succeeded')

  useEffect(() => {
    if (runningDeploy) {
      setActiveDeployId(runningDeploy.id)
      return
    }
    setActiveDeployId(null)
  }, [runningDeploy?.id])

  const envQuery = useQuery({
    queryKey: ['project', slug, 'env'],
    queryFn: () => fetchProjectEnv(slug),
    enabled: Boolean(slug) && activeTab === 'environment',
    refetchIntervalInBackground: false,
  })

  const routePortEnvVars = useMemo(
    () => project?.routes.map((route) => route.port_env_var) ?? [],
    [project?.routes],
  )

  useEffect(() => {
    if (!envQuery.data) {
      return
    }
    setLoadedEnvKeys(envQuery.data.entries.map((entry) => entry.key))
    setEnvRows(entriesToEnvRows(envQuery.data.entries, routePortEnvVars))
    setEnvDirty(false)
  }, [envQuery.data, routePortEnvVars])

  const dumpsQuery = useQuery({
    queryKey: ['project', slug, 'dumps'],
    queryFn: () => fetchProjectDumps(slug),
    enabled: Boolean(slug) && activeTab === 'database',
    refetchIntervalInBackground: false,
  })

  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    enabled: activeTab === 'routing',
    refetchIntervalInBackground: false,
  })

  const metricsByContainer = useMemo(() => {
    const map = new Map<string, { cpu_percent: number; mem_used: number }>()
    for (const row of metricsQuery.data ?? []) {
      if (row.name.startsWith(`${slug}-`)) {
        map.set(row.name, { cpu_percent: row.cpu_percent, mem_used: row.mem_used })
      }
    }
    return map
  }, [metricsQuery.data, slug])

  const deployMutation = useMutation({
    mutationFn: (body: { tags?: Record<string, string>; build?: boolean }) =>
      startProjectDeploy(slug, body),
    onSuccess: (data) => {
      setActiveDeployId(data.id)
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'deploys'] })
    },
  })

  const redeployMutation = useMutation({
    mutationFn: (deployId: number) => redeployDeploy(deployId),
    onSuccess: (data) => {
      setActiveDeployId(data.id)
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'deploys'] })
    },
  })

  const envSaveMutation = useMutation({
    mutationFn: async ({
      rows,
      loadedKeys,
    }: {
      rows: EnvRow[]
      loadedKeys: string[]
    }) => {
      const set = envRowsToPatchSet(rows)
      const unset = envKeysToPatchUnset(loadedKeys, rows, routePortEnvVars)
      await patchProjectEnv(slug, set, unset)
    },
    onSuccess: () => {
      setEnvDirty(false)
      setRestartPrompt(true)
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'env'] })
    },
  })

  const routingMutation = useMutation({
    mutationFn: () => {
      const routes: ProjectRoute[] = routesDraft.map((route) => {
        const existing = project?.routes.find(
          (row) =>
            row.path_prefix === route.path_prefix && row.port_env_var === route.port_env_var,
        )
        return {
          path_prefix: route.path_prefix,
          port_env_var: route.port_env_var,
          max_body_mb: existing?.max_body_mb ?? 25,
          read_timeout_s: existing?.read_timeout_s ?? 60,
          send_timeout_s: existing?.send_timeout_s ?? 60,
          streaming: existing?.streaming ?? false,
          websocket: existing?.websocket ?? false,
          pass_authorization: existing?.pass_authorization ?? false,
        }
      })
      return putProjectRouting(slug, { hostnames: hostnamesDraft, routes })
    },
    onSuccess: () => {
      setRoutingError(null)
      void queryClient.invalidateQueries({ queryKey: ['project', slug] })
    },
    onError: (error) => {
      const detail = apiErrorDetail(error)
      if (detail.includes('nginx')) {
        setRoutingError(detail)
      } else {
        setRoutingError('Could not save routing.')
      }
    },
  })

  const settingsMutation = useMutation({
    mutationFn: () =>
      patchProjectSettings(slug, {
        migration_command: migrationCommand || null,
        migration_service: migrationService || null,
        health_check_url: healthCheckUrl || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', slug] })
    },
  })

  const servicesSaveMutation = useMutation({
    mutationFn: () => {
      const prepared = prepareServiceMappingRows(servicesDraft)
      if (!prepared.ok) {
        throw new Error(prepared.error)
      }
      return putProjectServices(slug, prepared.rows)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', slug] })
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'tags'] })
    },
  })

  const detectFromCompose = useCallback(async () => {
    setDetectComposeError(null)
    setDetectComposeBusy(true)
    try {
      const data = await fetchComposeServices(slug)
      const existing = new Set(servicesDraft.map((row) => row.image_env_var))
      const appended: ServiceMappingRow[] = []
      for (const entry of data.services) {
        const imageVar = entry.image_var
        if (!imageVar || existing.has(imageVar)) {
          continue
        }
        const tagPrefix = tagPrefixFromImageEnvVar(imageVar)
        if (!tagPrefix) {
          continue
        }
        appended.push({
          service_name: entry.name,
          image_env_var: imageVar,
          tag_prefix: tagPrefix,
        })
        existing.add(imageVar)
      }
      if (appended.length > 0) {
        setServicesDraft((prev) => [...prev, ...appended])
      }
    } catch {
      setDetectComposeError('Could not load services from compose.')
    } finally {
      setDetectComposeBusy(false)
    }
  }, [servicesDraft, slug])

  const imageServicesConfigured = (project?.services.length ?? 0) > 0

  const rotateMutation = useMutation({
    mutationFn: () => rotateProjectDatabase(slug),
    onSuccess: () => {
      setDbRestartPrompt(true)
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'dumps'] })
    },
  })

  const restartMutation = useMutation({
    mutationFn: () => restartProjectCompose(slug),
    onSuccess: () => {
      setRestartPrompt(false)
      setDbRestartPrompt(false)
    },
  })

  const handleDelete = useCallback(
    async (payload: Parameters<typeof deleteProject>[1]) => {
      setDeleteBusy(true)
      setDeleteError(null)
      try {
        await deleteProject(slug, payload)
        await queryClient.invalidateQueries({ queryKey: ['projects'] })
        navigate('/projects')
      } catch (error) {
        if (isStepUpRequired(error)) {
          throw error
        }
        const detail = apiErrorDetail(error)
        setDeleteError(detail || 'Delete failed.')
      } finally {
        setDeleteBusy(false)
      }
    },
    [navigate, queryClient, slug],
  )

  const liveDeployLog =
    (activeDeployId !== null
      ? deploys.find((row) => row.id === activeDeployId)?.log
      : null) ??
    runningDeploy?.log ??
    ''

  const logServices = psQuery.data?.services ?? []

  if (projectQuery.isPending) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
        Loading project…
      </p>
    )
  }

  if (projectQuery.isError || !project) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">Project not found.</p>
        <Link to="/projects" className="text-sm text-accent">
          Back to projects
        </Link>
      </div>
    )
  }

  const publicUrls = projectPublicUrls(project)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{project.display_name}</h1>
        <p className="font-mono text-sm text-muted-foreground">{project.slug}</p>
      </div>

      <div
        role="tablist"
        aria-label="Project sections"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors duration-200 cursor-pointer ${
              activeTab === tab.id
                ? 'border border-b-0 border-border bg-card text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div role="tabpanel" className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Services</h2>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Service</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Image</th>
                    <th className="px-3 py-2 font-medium">Started</th>
                    <th className="px-3 py-2 text-right font-medium">CPU</th>
                    <th className="px-3 py-2 text-right font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(psQuery.data?.services ?? []).map((svc) => {
                    const containerName = `${slug}-${svc.name}`
                    const metrics = metricsByContainer.get(containerName)
                    const variant = composeServiceStatusVariant(svc.state, svc.health)
                    return (
                      <tr key={svc.name}>
                        <td className="px-3 py-2 font-mono">{svc.name}</td>
                        <td className="px-3 py-2">
                          <StatusBadge variant={variant} label={svc.state || variant} />
                        </td>
                        <td className="max-w-xs truncate px-3 py-2 font-mono text-xs">{svc.image}</td>
                        <td className="px-3 py-2 text-muted-foreground">{svc.started_at || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {metrics ? `${metrics.cpu_percent.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {metrics ? formatBytes(metrics.mem_used) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
          {publicUrls.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">URLs</h2>
              <ul className="space-y-1 text-sm">
                {publicUrls.map((url) => (
                  <li key={url}>
                    <a href={url} className="font-mono text-accent hover:underline">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'deploy' ? (
        <div role="tabpanel" className="space-y-6">
          {latestDeploy?.status === 'failed_after_switch' ? (
            <div className="rounded-md border border-warning/50 bg-warning/10 p-4 text-sm">
              <p>This deploy failed after the new version was started</p>
              <button
                type="button"
                disabled={!latestSucceeded || redeployMutation.isPending}
                className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 cursor-pointer"
                onClick={() => latestSucceeded && redeployMutation.mutate(latestSucceeded.id)}
              >
                Roll back to last good deploy
              </button>
            </div>
          ) : null}

          {project.deploy_mode === 'image' && !imageServicesConfigured ? (
            <p className="text-sm text-muted-foreground">
              Image services are not configured.{' '}
              <button
                type="button"
                className="text-accent hover:underline cursor-pointer"
                onClick={() => selectTab('settings')}
              >
                Open Settings
              </button>{' '}
              to map compose services to Docker Hub tags.
            </p>
          ) : null}

          {project.deploy_mode === 'image' && imageServicesConfigured ? (
            <div className="space-y-4">
              {(tagsQuery.data?.services ?? []).map((svc) => {
                const options = normalizeRegistryTags(svc.tags)
                return (
                  <div key={svc.image_env_var} className="rounded-md border border-border p-4">
                    <p className="mb-2 text-sm font-medium">{svc.service}</p>
                    <TagPicker
                      tags={options}
                      selectedName={selectedTags[svc.image_env_var] ?? options[0]?.name ?? ''}
                      onSelectedNameChange={(name) =>
                        setSelectedTags((prev) => ({ ...prev, [svc.image_env_var]: name }))
                      }
                    />
                  </div>
                )
              })}
              <button
                type="button"
                disabled={deployMutation.isPending || Object.keys(selectedTags).length === 0}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
                onClick={() => deployMutation.mutate({ tags: selectedTags })}
              >
                Deploy
              </button>
            </div>
          ) : project.deploy_mode === 'build' ? (
            <button
              type="button"
              disabled={deployMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
              onClick={() => deployMutation.mutate({ build: true })}
            >
              Build &amp; deploy
            </button>
          ) : null}

          {liveDeployLog ? (
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs">
              {liveDeployLog}
            </pre>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Deploy history</h2>
            <ul className="divide-y divide-border rounded-md border border-border">
              {deploys.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-mono">#{row.id}</span>{' '}
                    <span className="text-muted-foreground">{row.status}</span>
                  </div>
                  {row.status === 'succeeded' ? (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted cursor-pointer"
                      onClick={() => redeployMutation.mutate(row.id)}
                    >
                      Redeploy
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {activeTab === 'logs' ? (
        <div role="tabpanel" className="space-y-3">
          <label className="text-sm font-medium" htmlFor="log-service">
            Service
          </label>
          <select
            id="log-service"
            className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={logService}
            onChange={(event) => setLogService(event.target.value)}
          >
            <option value="">all</option>
            {logServices.map((svc) => (
              <option key={svc.name} value={svc.name}>
                {svc.name}
              </option>
            ))}
          </select>
          <ComposeLogsViewer slug={slug} service={logService} />
        </div>
      ) : null}

      {activeTab === 'environment' ? (
        <div role="tabpanel" className="space-y-4">
          {envQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading environment…</p>
          ) : (
            <>
              <EnvEditor
                rows={envRows}
                routePortEnvVars={routePortEnvVars}
                onChange={(rows) => {
                  setEnvRows(rows)
                  setEnvDirty(true)
                }}
              />
              <button
                type="button"
                disabled={!envDirty || envSaveMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
                onClick={() =>
                  envSaveMutation.mutate({ rows: envRows, loadedKeys: loadedEnvKeys })
                }
              >
                Save
              </button>
              {restartPrompt ? (
                <div className="rounded-md border border-border bg-card p-4 text-sm">
                  <p>Restart services?</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background cursor-pointer"
                      onClick={() => restartMutation.mutate()}
                    >
                      Restart
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-2 text-sm cursor-pointer"
                      onClick={() => setRestartPrompt(false)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'routing' ? (
        <div role="tabpanel" className="space-y-4">
          {routingError ? <p className="text-sm text-destructive">{routingError}</p> : null}
          <HostnameEditor
            hostnames={hostnamesDraft}
            domains={(domainsQuery.data ?? []).map((row) => row.name)}
            onChange={setHostnamesDraft}
          />
          <RouteEditor routes={routesDraft} onChange={setRoutesDraft} />
          <button
            type="button"
            disabled={routingMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
            onClick={() => routingMutation.mutate()}
          >
            Save routing
          </button>
        </div>
      ) : null}

      {activeTab === 'database' ? (
        <div role="tabpanel" className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Database</dt>
              <dd className="font-mono">{project.db_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">User</dt>
              <dd className="font-mono">{project.db_user ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Size</dt>
              <dd className="font-mono">—</dd>
            </div>
          </dl>
          {project.database_mode !== 'none' ? (
            <button
              type="button"
              disabled={rotateMutation.isPending}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted cursor-pointer"
              onClick={() => rotateMutation.mutate()}
            >
              Rotate password
            </button>
          ) : null}
          {dbRestartPrompt ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm">
              <p>Restart services?</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background cursor-pointer"
                  onClick={() => restartMutation.mutate()}
                >
                  Restart
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-2 text-sm cursor-pointer"
                  onClick={() => setDbRestartPrompt(false)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Dumps</h2>
            <ul className="divide-y divide-border rounded-md border border-border">
              {(dumpsQuery.data ?? []).map((dump) => (
                <li key={dump.name} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-mono">{dump.name}</span>
                  <a
                    href={projectDumpDownloadUrl(slug, dump.name)}
                    className="text-accent hover:underline"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {activeTab === 'settings' ? (
        <div role="tabpanel" className="space-y-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Repository</dt>
              <dd className="break-all font-mono">{project.repo_url}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="font-mono">{project.branch}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Deploy mode</dt>
              <dd>{project.deploy_mode}</dd>
            </div>
          </dl>
          {project.deploy_mode === 'image' ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Image services</h2>
                <button
                  type="button"
                  disabled={detectComposeBusy}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 cursor-pointer"
                  onClick={() => void detectFromCompose()}
                >
                  Detect from compose
                </button>
              </div>
              {detectComposeError ? (
                <p className="text-sm text-destructive">{detectComposeError}</p>
              ) : null}
              <ServiceMappingEditor
                services={servicesDraft}
                onChange={setServicesDraft}
                onValidationChange={(ok) => setServicesMappingValid(ok)}
              />
              <button
                type="button"
                disabled={!servicesMappingValid || servicesSaveMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
                onClick={() => servicesSaveMutation.mutate()}
              >
                Save services
              </button>
            </section>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="migration-command">
                Migration command
              </label>
              <input
                id="migration-command"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                value={migrationCommand}
                onChange={(event) => setMigrationCommand(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="migration-service">
                Migration service
              </label>
              <input
                id="migration-service"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                value={migrationService}
                onChange={(event) => setMigrationService(event.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium" htmlFor="health-check-url">
                Health check URL
              </label>
              <input
                id="health-check-url"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                value={healthCheckUrl}
                onChange={(event) => setHealthCheckUrl(event.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={settingsMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
            onClick={() => settingsMutation.mutate()}
          >
            Save settings
          </button>
          <ProjectDeleteSection
            slug={slug}
            onDelete={handleDelete}
            busy={deleteBusy}
            error={deleteError}
          />
        </div>
      ) : null}
    </div>
  )
}
