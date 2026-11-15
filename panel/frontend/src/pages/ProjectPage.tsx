import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ComposeLogsViewer } from '../components/projects/ComposeLogsViewer'
import { DeployHistory } from '../components/projects/DeployHistory'
import { DeployLogBox } from '../components/projects/DeployLogBox'
import { EnvEditor } from '../components/projects/EnvEditor'
import { HostnameEditor } from '../components/projects/HostnameEditor'
import { ProjectDeleteSection } from '../components/projects/ProjectDeleteSection'
import { ProjectPortsSection } from '../components/projects/ProjectPortsSection'
import { RouteEditor } from '../components/projects/RouteEditor'
import { ServiceMappingEditor } from '../components/projects/ServiceMappingEditor'
import { TagPicker } from '../components/projects/TagPicker'
import { StatusBadge } from '../components/StatusBadge'
import { ApiError, isStepUpRequired } from '../lib/api'
import { authQueryKey } from '../lib/auth'
import { fetchDatabases, rotateDatabasePassword } from '../lib/databaseApi'
import { composeServiceStatusVariant } from '../lib/composeServiceStatus'
import { fetchContainerMetrics } from '../lib/dashboardApi'
import { fetchDomains } from '../lib/domainsApi'
import type { EnvRow } from '../lib/envEditorUtils'
import { formatBytes, formatStartedAt } from '../lib/format'
import {
  entriesToEnvRows,
  envKeysToPatchUnset,
  envRowsToPatchSet,
  fillRenamedSetValues,
  renamedRowsNeedingReveal,
} from '../lib/projectEnv'
import type { ComposePsService, RegistryTagOption } from '../lib/projectDeployTypes'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  TableContainer,
  Tabs,
  TabsList,
  TabsTrigger,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui'
import { StepUpDialog } from '../components/StepUpDialog'
import { MigrationRunControls } from '../components/projects/MigrationRunControls'
import { LogViewer } from '../components/setup/LogViewer'
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
  fetchProjectPorts,
  fetchProjectTags,
  deployToApplyEnv,
  patchProjectEnv,
  patchProjectSettings,
  projectDumpDownloadUrl,
  putProjectRouting,
  putProjectServices,
  redeployDeploy,
  migrateProject,
  startProjectDeploy,
  type ProjectDetail,
  type ProjectHostname,
  type ProjectRoute,
} from '../lib/projectsApi'
import { buildFqdn } from '../lib/subdomainValidation'
import { validateRoutes, type RouteDraft } from '../lib/routeValidation'
import {
  runtimeStatusFromComposeServices,
  runtimeStatusLabel,
  runtimeStatusTone,
} from '../lib/projectRuntime'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'logs', label: 'Logs' },
  { id: 'environment', label: 'Environment' },
  { id: 'routing', label: 'Routing' },
  { id: 'ports', label: 'Ports' },
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

export const MIGRATION_LOG_HOLD_MS = 20_000

function composeServiceLabel(svc: ComposePsService): string {
  return svc.name || svc.service || ''
}

function metricsForService(
  rows: { name: string; cpu_percent: number; mem_used: number }[],
  slug: string,
  serviceName: string,
  container?: string,
): { cpu_percent: number; mem_used: number } | undefined {
  if (container) {
    const named = rows.find((row) => row.name === container)
    if (named) {
      return { cpu_percent: named.cpu_percent, mem_used: named.mem_used }
    }
  }
  if (!serviceName) {
    return undefined
  }
  const exact = `${slug}-${serviceName}`
  const prefixed = rows.find((row) => row.name === exact || row.name.startsWith(`${exact}-`))
  if (!prefixed) {
    return undefined
  }
  return { cpu_percent: prefixed.cpu_percent, mem_used: prefixed.mem_used }
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

function mutationErrorMessage(error: unknown, fallback: string): string {
  const detail = apiErrorDetail(error)
  if (detail) {
    return detail
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function ProjectPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<TabId>(() => tabFromHash(window.location.hash))
  const [logService, setLogService] = useState('')
  const [selectedTags, setSelectedTags] = useState<Record<string, string>>({})
  const [runMigrations, setRunMigrations] = useState(true)
  const [activeDeployId, setActiveDeployId] = useState<number | null>(null)
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [loadedEnvKeys, setLoadedEnvKeys] = useState<string[]>([])
  const [envDirty, setEnvDirty] = useState(false)
  const [applyPrompt, setApplyPrompt] = useState<'env' | 'password' | null>(null)
  const [applyDeployError, setApplyDeployError] = useState<string | null>(null)
  const [rotateStepUpOpen, setRotateStepUpOpen] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [rotateMessage, setRotateMessage] = useState<string | null>(null)
  const [envSavedMessage, setEnvSavedMessage] = useState<string | null>(null)
  const revealedEnvRef = useRef<Map<string, string> | null>(null)
  const [hostnamesDraft, setHostnamesDraft] = useState<ProjectHostname[]>([])
  const [routesDraft, setRoutesDraft] = useState<RouteDraft[]>([])
  const [routingError, setRoutingError] = useState<string | null>(null)
  const [migrationCommand, setMigrationCommand] = useState('')
  const [migrationService, setMigrationService] = useState('')
  const [healthCheckUrl, setHealthCheckUrl] = useState('')
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
  const projectFormKey = project
    ? JSON.stringify({
        hostnames: project.hostnames,
        routes: project.routes,
        migration_command: project.migration_command,
        migration_service: project.migration_service,
        health_check_url: project.health_check_url,
        services: project.services,
      })
    : null
  const [appliedProjectFormKey, setAppliedProjectFormKey] = useState<string | null>(null)
  if (project && projectFormKey !== null && appliedProjectFormKey !== projectFormKey) {
    setAppliedProjectFormKey(projectFormKey)
    setHostnamesDraft(project.hostnames)
    setRoutesDraft(
      project.routes.map((route) => ({
        path_prefix: route.path_prefix,
        port_env_var: route.port_env_var,
        max_body_mb: route.max_body_mb,
        read_timeout_s: route.read_timeout_s,
        send_timeout_s: route.send_timeout_s,
        streaming: route.streaming,
        websocket: route.websocket,
        pass_authorization: route.pass_authorization,
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
  }

  const projectReady = project?.creation_state.status === 'ready'

  const psQuery = useQuery({
    queryKey: ['project', slug, 'compose-ps'],
    queryFn: () => fetchComposePs(slug),
    enabled: Boolean(slug) && projectReady,
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

  const imageDeployTab =
    Boolean(slug) && activeTab === 'deploy' && project?.deploy_mode === 'image'
  useEffect(() => {
    if (imageDeployTab) {
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'tags'] })
    }
  }, [imageDeployTab, queryClient, slug])

  const tagsData = tagsQuery.data
  const [appliedTagsData, setAppliedTagsData] = useState(tagsData)
  if (tagsData && appliedTagsData !== tagsData) {
    setAppliedTagsData(tagsData)
    setSelectedTags((prev) => {
      const next = { ...prev }
      for (const svc of tagsData.services) {
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
  }

  const deployMutation = useMutation({
    mutationFn: (body: {
      tags?: Record<string, string>
      build?: boolean
      run_migrations?: boolean
    }) => startProjectDeploy(slug, body),
    onSuccess: (data) => {
      setActiveDeployId(data.id)
      toast({ title: 'Deploy started', tone: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'deploys'] })
    },
  })

  const redeployMutation = useMutation({
    mutationFn: (deployId: number) => redeployDeploy(deployId),
    onSuccess: (data) => {
      setActiveDeployId(data.id)
      toast({ title: 'Redeploy started', tone: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'deploys'] })
    },
  })

  const applyDeployMutation = useMutation({
    mutationFn: () => deployToApplyEnv(slug),
    onSuccess: (data) => {
      setApplyPrompt(null)
      setApplyDeployError(null)
      setActiveDeployId(data.id)
      selectTab('deploy')
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'deploys'] })
    },
    onError: (error) => {
      setApplyDeployError(apiErrorDetail(error) || 'Deploy failed.')
    },
  })

  const deployPending =
    deployMutation.isPending || redeployMutation.isPending || applyDeployMutation.isPending
  const deploysQuery = useQuery({
    queryKey: ['project', slug, 'deploys'],
    queryFn: () => fetchProjectDeploys(slug),
    enabled: Boolean(slug) && activeTab === 'deploy',
    refetchInterval: (query) => {
      if (activeTab !== 'deploy') {
        return false
      }
      // The deploy POST blocks until the deploy finishes, so a freshly
      // started deploy only shows up via this polling — the mutation's
      // success handler (which invalidates) fires way too late.
      if (deployPending) {
        return 2000
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
  const runningDeployId = runningDeploy?.id ?? null
  const [seenRunningDeployId, setSeenRunningDeployId] = useState<number | null>(null)
  // Adopt a newly running deploy, but keep activeDeployId when the deploy
  // finishes so DeployLogBox can hold the terminal log for its grace period.
  if (runningDeployId !== null && seenRunningDeployId !== runningDeployId) {
    setSeenRunningDeployId(runningDeployId)
    setActiveDeployId(runningDeployId)
  }

  const revealEnvValue = useCallback(
    async (key: string) => {
      if (!revealedEnvRef.current) {
        const data = await fetchProjectEnv(slug, { reveal: true })
        revealedEnvRef.current = new Map(data.entries.map((entry) => [entry.key, entry.value]))
      }
      return revealedEnvRef.current.get(key) ?? ''
    },
    [slug],
  )

  const envQuery = useQuery({
    queryKey: ['project', slug, 'env'],
    queryFn: () => {
      revealedEnvRef.current = null
      return fetchProjectEnv(slug)
    },
    enabled: Boolean(slug) && activeTab === 'environment',
    refetchIntervalInBackground: false,
  })

  const routePortEnvVars = useMemo(
    () => project?.routes.map((route) => route.port_env_var) ?? [],
    [project?.routes],
  )
  const envEntriesKey = envQuery.data ? JSON.stringify(envQuery.data.entries) : null
  const envRoutePortsKey = JSON.stringify(routePortEnvVars)
  const [appliedEnvEntriesKey, setAppliedEnvEntriesKey] = useState<string | null>(null)
  const [appliedEnvRoutePortsKey, setAppliedEnvRoutePortsKey] = useState<string | null>(null)
  if (envQuery.data && envEntriesKey !== null) {
    const entriesChanged = appliedEnvEntriesKey !== envEntriesKey
    const routePortsChanged = appliedEnvRoutePortsKey !== envRoutePortsKey
    if (entriesChanged) {
      setAppliedEnvEntriesKey(envEntriesKey)
      setAppliedEnvRoutePortsKey(envRoutePortsKey)
      setLoadedEnvKeys(envQuery.data.entries.map((entry) => entry.key))
      setEnvRows(entriesToEnvRows(envQuery.data.entries, routePortEnvVars))
      setEnvDirty(false)
    } else if (!envDirty && routePortsChanged) {
      setAppliedEnvRoutePortsKey(envRoutePortsKey)
      setLoadedEnvKeys(envQuery.data.entries.map((entry) => entry.key))
      setEnvRows(entriesToEnvRows(envQuery.data.entries, routePortEnvVars))
    }
  }

  const routesValidation = validateRoutes(routesDraft)

  const dumpsQuery = useQuery({
    queryKey: ['project', slug, 'dumps'],
    queryFn: () => fetchProjectDumps(slug),
    enabled: Boolean(slug) && activeTab === 'database',
    refetchIntervalInBackground: false,
  })

  const databasesQuery = useQuery({
    queryKey: ['database', 'databases'],
    queryFn: fetchDatabases,
    enabled: Boolean(slug) && activeTab === 'database' && Boolean(project?.db_name),
    refetchIntervalInBackground: false,
  })
  const databaseSizeBytes = databasesQuery.data?.find((row) => row.name === project?.db_name)
    ?.size_bytes

  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    enabled: activeTab === 'routing',
    refetchIntervalInBackground: false,
  })

  const portsQuery = useQuery({
    queryKey: ['projects', slug, 'ports'],
    queryFn: () => fetchProjectPorts(slug),
    enabled: activeTab === 'routing',
    refetchIntervalInBackground: false,
  })
  const portEnvVarOptions = (portsQuery.data?.ports ?? [])
    .map((row) => row.env_var)
    .filter((envVar) => envVar !== '')

  const [migrateJobId, setMigrateJobId] = useState<string | null>(null)
  const migrateDismissTimer = useRef<number | null>(null)
  const clearMigrateDismiss = useCallback(() => {
    if (migrateDismissTimer.current !== null) {
      window.clearTimeout(migrateDismissTimer.current)
      migrateDismissTimer.current = null
    }
  }, [])
  const holdMigrationLog = useCallback(() => {
    clearMigrateDismiss()
    migrateDismissTimer.current = window.setTimeout(() => {
      migrateDismissTimer.current = null
      setMigrateJobId(null)
    }, MIGRATION_LOG_HOLD_MS)
  }, [clearMigrateDismiss])

  useEffect(() => clearMigrateDismiss, [clearMigrateDismiss])

  const migrateMutation = useMutation({
    mutationFn: () => migrateProject(slug),
    onSuccess: (data) => {
      clearMigrateDismiss()
      setActiveDeployId(null)
      setMigrateJobId(data.job_id)
      toast({ title: 'Migration started', tone: 'success' })
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
      let set = envRowsToPatchSet(rows)
      const unset = envKeysToPatchUnset(loadedKeys, rows, routePortEnvVars)
      const renamed = renamedRowsNeedingReveal(rows)
      if (renamed.length > 0) {
        // A renamed row keeps the masked placeholder as its value, so saving
        // would delete the original key without recreating it. Fetch the
        // stored value for the original key and patch it under the new name.
        const data = await fetchProjectEnv(slug, { reveal: true })
        const revealed = new Map(data.entries.map((entry) => [entry.key, entry.value]))
        const filled = fillRenamedSetValues(set, renamed, revealed)
        if (filled.missing.length > 0) {
          throw new Error(`Could not load the value for: ${filled.missing.join(', ')}`)
        }
        set = filled.set
      }
      await patchProjectEnv(slug, set, unset)
    },
    onSuccess: () => {
      setEnvDirty(false)
      setEnvSavedMessage(null)
      setApplyDeployError(null)
      setApplyPrompt('env')
      toast({ title: 'Environment saved', tone: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['project', slug, 'env'] })
    },
  })

  const routingMutation = useMutation({
    mutationFn: () => {
      const routes: ProjectRoute[] = routesDraft.map((route) => ({
        path_prefix: route.path_prefix,
        port_env_var: route.port_env_var,
        max_body_mb: route.max_body_mb ?? 25,
        read_timeout_s: route.read_timeout_s ?? 60,
        send_timeout_s: route.send_timeout_s ?? 60,
        streaming: route.streaming ?? false,
        websocket: route.websocket ?? false,
        pass_authorization: route.pass_authorization ?? false,
      }))
      return putProjectRouting(slug, { hostnames: hostnamesDraft, routes })
    },
    onSuccess: () => {
      setRoutingError(null)
      toast({ title: 'Routing saved', tone: 'success' })
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
      toast({ title: 'Settings saved', tone: 'success' })
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
      toast({ title: 'Services saved', tone: 'success' })
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
    mutationFn: async () => {
      setRotateError(null)
      try {
        const result = await rotateDatabasePassword(slug)
        if (result.restart_required) {
          setRotateMessage(null)
          setApplyDeployError(null)
          setApplyPrompt('password')
        }
        await queryClient.invalidateQueries({ queryKey: ['project', slug, 'dumps'] })
        await queryClient.invalidateQueries({ queryKey: ['database'] })
        await queryClient.invalidateQueries({ queryKey: authQueryKey })
      } catch (error) {
        if (isStepUpRequired(error)) {
          setRotateStepUpOpen(true)
          return
        }
        setRotateMessage(null)
        setRotateError(apiErrorDetail(error) || 'Request failed.')
      }
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

  const activeDeploy =
    (activeDeployId !== null
      ? deploys.find((row) => row.id === activeDeployId)
      : null) ?? runningDeploy ?? null

  const logServices = psQuery.data?.services ?? []

  const routingDirty = useMemo(() => {
    if (!project) {
      return false
    }
    const baseline = {
      hostnames: project.hostnames,
      routes: project.routes,
    }
    const draft = {
      hostnames: hostnamesDraft,
      routes: routesDraft.map((route) => ({
        path_prefix: route.path_prefix,
        port_env_var: route.port_env_var,
        max_body_mb: route.max_body_mb ?? 25,
        read_timeout_s: route.read_timeout_s ?? 60,
        send_timeout_s: route.send_timeout_s ?? 60,
        streaming: route.streaming ?? false,
        websocket: route.websocket ?? false,
        pass_authorization: route.pass_authorization ?? false,
      })),
    }
    return JSON.stringify(baseline) !== JSON.stringify(draft)
  }, [project, hostnamesDraft, routesDraft])

  const settingsDirty = useMemo(() => {
    if (!project) {
      return false
    }
    return (
      migrationCommand !== (project.migration_command ?? '') ||
      migrationService !== (project.migration_service ?? '') ||
      healthCheckUrl !== (project.health_check_url ?? '')
    )
  }, [project, migrationCommand, migrationService, healthCheckUrl])

  const servicesDirty = useMemo(() => {
    if (!project) {
      return false
    }
    const baseline = project.services.map((row) => ({
      service_name: row.service_name,
      image_env_var: row.image_env_var,
      tag_prefix: row.tag_prefix,
    }))
    const draft = servicesDraft.map((row) => ({
      service_name: row.service_name,
      image_env_var: row.image_env_var,
      tag_prefix: row.tag_prefix,
    }))
    return JSON.stringify(baseline) !== JSON.stringify(draft)
  }, [project, servicesDraft])

  useUnsavedChangesWarning(envDirty || routingDirty || settingsDirty || servicesDirty)

  if (projectQuery.isPending) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading project…
      </p>
    )
  }

  if (projectQuery.isError || !project) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive" role="alert">Could not load project.</p>
        <Link
          to="/projects"
          className="text-sm font-medium underline-offset-2 hover:underline cursor-pointer text-accent"
        >
          Back to projects
        </Link>
      </div>
    )
  }

  const publicUrls = projectPublicUrls(project)
  const primaryUrl = publicUrls[0]
  const headerRuntime =
    psQuery.data?.services !== undefined
      ? runtimeStatusFromComposeServices(psQuery.data.services)
      : null

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-6">
      <PageHeader
        title={project.display_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{project.slug}</span>
            {headerRuntime ? (
              <Badge tone={runtimeStatusTone(headerRuntime)} dot>
                {runtimeStatusLabel(headerRuntime)}
              </Badge>
            ) : null}
            {primaryUrl ? (
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-accent hover:underline"
              >
                {primaryUrl}
              </a>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button type="button" aria-label="Open Deploy tab" onClick={() => selectTab('deploy')}>
              Deploy
            </Button>
            <Button type="button" variant="secondary" aria-label="Open Logs tab" onClick={() => selectTab('logs')}>
              Logs
            </Button>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={(value) => selectTab(value as TabId)}>
        <TabsList aria-label="Project sections" className="flex-wrap gap-1">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === 'overview' ? (
        <div role="tabpanel" className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Services</h2>
            <TableContainer>
              <Table>
                <THead className="border-b border-border bg-muted/40">
                  <TR className="hover:bg-transparent">
                    <TH scope="col" className="normal-case tracking-normal">Service</TH>
                    <TH scope="col" className="normal-case tracking-normal">Status</TH>
                    <TH scope="col" className="normal-case tracking-normal">Image</TH>
                    <TH scope="col" className="normal-case tracking-normal">Ports</TH>
                    <TH scope="col" className="normal-case tracking-normal">Started</TH>
                    <TH scope="col" className="text-right normal-case tracking-normal">CPU</TH>
                    <TH scope="col" className="text-right normal-case tracking-normal">Memory</TH>
                  </TR>
                </THead>
                <TBody>
                  {(psQuery.data?.services ?? []).length === 0 && !psQuery.isPending ? (
                    <TR>
                      <TD colSpan={7} className="py-6 text-muted-foreground">
                        No services yet.
                      </TD>
                    </TR>
                  ) : null}
                  {(psQuery.data?.services ?? []).map((svc, index) => {
                    const serviceName = composeServiceLabel(svc)
                    const metrics = metricsForService(
                      metricsQuery.data ?? [],
                      slug,
                      serviceName,
                      svc.container,
                    )
                    const variant = composeServiceStatusVariant(svc.state, svc.health)
                    return (
                      <TR key={svc.container || serviceName || index}>
                        <TD className="font-mono">{serviceName}</TD>
                        <TD>
                          <StatusBadge variant={variant} label={svc.state || variant} />
                        </TD>
                        <TD className="min-w-0 font-mono text-xs break-all">{svc.image}</TD>
                        <TD className="font-mono text-xs text-muted-foreground">
                          {(svc.ports ?? []).length > 0 ? svc.ports!.join(', ') : '—'}
                        </TD>
                        <TD className="text-muted-foreground">
                          {svc.started_at ? formatStartedAt(svc.started_at) : '—'}
                        </TD>
                        <TD className="text-right font-mono">
                          {metrics ? `${metrics.cpu_percent.toFixed(1)}%` : '—'}
                        </TD>
                        <TD className="text-right font-mono">
                          {metrics ? formatBytes(metrics.mem_used) : '—'}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </TableContainer>
          </section>
          {publicUrls.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold">URLs</h2>
              <ul className="space-y-1 text-sm">
                {publicUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-accent hover:underline"
                    >
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
            <div className="space-y-2">
              <Alert
                tone="warning"
                title="This deploy failed after the new version was started."
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!latestSucceeded || redeployMutation.isPending}
                    onClick={() => latestSucceeded && redeployMutation.mutate(latestSucceeded.id)}
                  >
                    Roll back to last good deploy
                  </Button>
                }
              />
              {redeployMutation.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {mutationErrorMessage(redeployMutation.error, 'Redeploy failed.')}
                </p>
              ) : null}
            </div>
          ) : null}

          {project.deploy_mode === 'image' && !imageServicesConfigured ? (
            <p className="text-sm text-muted-foreground">
              Image services are not configured.{' '}
              <button
                type="button"
                className="text-sm font-medium underline-offset-2 hover:underline cursor-pointer text-accent"
                onClick={() => selectTab('settings')}
              >
                Open Settings
              </button>{' '}
              to map compose services to Docker Hub tags.
            </p>
          ) : null}

          <div className="space-y-2">
            <MigrationRunControls
              configured={Boolean(project.migration_service && project.migration_command)}
              command={project.migration_command}
              runMigrations={runMigrations}
              onToggle={setRunMigrations}
              onRunNow={() => migrateMutation.mutate()}
              hasDatabase={project.database_mode !== 'none'}
              runNowDisabled={migrateMutation.isPending}
            />
            {migrateMutation.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {mutationErrorMessage(migrateMutation.error, 'Migration failed.')}
              </p>
            ) : null}
          </div>

          {project.deploy_mode === 'image' && imageServicesConfigured ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {(tagsQuery.data?.services ?? []).map((svc) => {
                  const options = normalizeRegistryTags(svc.tags)
                  return (
                    <Card key={svc.image_env_var} className="p-4">
                      <p className="mb-2 text-sm font-semibold">{svc.service}</p>
                      <TagPicker
                        tags={options}
                        selectedName={selectedTags[svc.image_env_var] ?? options[0]?.name ?? ''}
                        onSelectedNameChange={(name) =>
                          setSelectedTags((prev) => ({ ...prev, [svc.image_env_var]: name }))
                        }
                      />
                    </Card>
                  )
                })}
              </div>
              <Button
                type="button"
                disabled={deployMutation.isPending || Object.keys(selectedTags).length === 0}
                loading={deployMutation.isPending}
                onClick={() => deployMutation.mutate({ tags: selectedTags, run_migrations: runMigrations })}
              >
                {deployMutation.isPending ? 'Deploying…' : 'Deploy'}
              </Button>
              {deployMutation.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {mutationErrorMessage(deployMutation.error, 'Deploy failed.')}
                </p>
              ) : null}
            </div>
          ) : project.deploy_mode === 'build' ? (
            <>
              <Button
                type="button"
                disabled={deployMutation.isPending}
                loading={deployMutation.isPending}
                onClick={() => deployMutation.mutate({ build: true, run_migrations: runMigrations })}
              >
                {deployMutation.isPending ? 'Deploying…' : 'Build & deploy'}
              </Button>
              {deployMutation.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {mutationErrorMessage(deployMutation.error, 'Deploy failed.')}
                </p>
              ) : null}
            </>
          ) : null}

          {activeDeploy ? (
            <DeployLogBox key={activeDeploy.id} deploy={activeDeploy} />
          ) : null}

          {migrateJobId ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Migration log</h2>
              <LogViewer
                key={migrateJobId}
                jobId={migrateJobId}
                onEnd={holdMigrationLog}
              />
            </div>
          ) : null}

          {redeployMutation.isError && latestDeploy?.status !== 'failed_after_switch' ? (
            <p className="text-sm text-destructive" role="alert">
              {mutationErrorMessage(redeployMutation.error, 'Redeploy failed.')}
            </p>
          ) : null}
          <DeployHistory
            deploys={deploys}
            isPending={deploysQuery.isPending}
            redeployPending={redeployMutation.isPending}
            onRedeploy={(deployId) => redeployMutation.mutate(deployId)}
          />
        </div>
      ) : null}

      {activeTab === 'logs' ? (
        <div role="tabpanel" className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="log-service">
            Service
          </label>
          <Select
            id="log-service"
            className="mt-1 w-full max-w-xs"
            value={logService}
            onChange={(event) => setLogService(event.target.value)}
          >
            <option value="">All services</option>
            <optgroup label="Services">
              {logServices.map((svc) => {
                const name = composeServiceLabel(svc)
                if (!name) {
                  return null
                }
                return (
                  <option key={svc.container || name} value={name}>
                    {name}
                  </option>
                )
              })}
            </optgroup>
          </Select>
          <ComposeLogsViewer key={`${slug}:${logService}`} slug={slug} service={logService} />
        </div>
      ) : null}

      {activeTab === 'environment' ? (
        <div role="tabpanel" className="min-w-0 space-y-4">
          {envQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading environment…</p>
          ) : (
            <>
              <EnvEditor
                rows={envRows}
                routePortEnvVars={routePortEnvVars}
                onRevealValue={revealEnvValue}
                onChange={(rows) => {
                  setEnvRows(rows)
                  setEnvDirty(true)
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={!envDirty || envSaveMutation.isPending}
                  loading={envSaveMutation.isPending}
                  onClick={() =>
                    envSaveMutation.mutate({ rows: envRows, loadedKeys: loadedEnvKeys })
                  }
                >
                  {envSaveMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
                {envDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
              </div>
              {envSaveMutation.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {mutationErrorMessage(envSaveMutation.error, 'Could not save environment.')}
                </p>
              ) : null}
              {envSavedMessage ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {envSavedMessage}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'routing' ? (
        <div role="tabpanel" className="space-y-4">
          {routingError ? (
            <p className="text-sm text-destructive" role="alert">{routingError}</p>
          ) : null}
          <HostnameEditor
            hostnames={hostnamesDraft}
            domains={(domainsQuery.data ?? []).map((row) => row.name)}
            onChange={setHostnamesDraft}
          />
          <RouteEditor
            routes={routesDraft}
            onChange={setRoutesDraft}
            portEnvVarOptions={portEnvVarOptions}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={routingMutation.isPending || !routesValidation.ok}
              loading={routingMutation.isPending}
              onClick={() => routingMutation.mutate()}
            >
              {routingMutation.isPending ? 'Saving…' : 'Save routing'}
            </Button>
            {routingDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'ports' ? (
        <div role="tabpanel" className="min-w-0 space-y-4">
          <ProjectPortsSection slug={slug} />
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
              <dd className="font-mono">
                {databaseSizeBytes == null ? '—' : formatBytes(databaseSizeBytes)}
              </dd>
            </div>
          </dl>
          {project.database_mode !== 'none' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={rotateMutation.isPending}
              onClick={() => rotateMutation.mutate()}
            >
              Rotate password
            </Button>
          ) : null}
          {rotateError ? (
            <p className="text-sm text-destructive" role="alert">
              {rotateError}
            </p>
          ) : null}
          {rotateMessage ? (
            <p className="text-sm text-muted-foreground" role="status">
              {rotateMessage}
            </p>
          ) : null}
          <StepUpDialog
            open={rotateStepUpOpen}
            busy={rotateMutation.isPending}
            onVerified={() => {
              setRotateStepUpOpen(false)
              rotateMutation.mutate()
            }}
            onCancel={() => setRotateStepUpOpen(false)}
          />
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Dumps</h2>
            <Card className="overflow-x-auto p-0">
              <ul className="w-full divide-y divide-border">
              {!dumpsQuery.isPending && (dumpsQuery.data ?? []).length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground">No dumps yet.</li>
              ) : null}
              {(dumpsQuery.data ?? []).map((dump) => (
                <li key={dump.name} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-mono">{dump.name}</span>
                  <a
                    href={projectDumpDownloadUrl(slug, dump.name)}
                    className="text-sm font-medium underline-offset-2 hover:underline cursor-pointer text-accent"
                  >
                    Download
                  </a>
                </li>
              ))}
              </ul>
            </Card>
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
                <h2 className="text-base font-semibold">Image services</h2>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={detectComposeBusy}
                  loading={detectComposeBusy}
                  onClick={() => void detectFromCompose()}
                >
                  {detectComposeBusy ? 'Detecting…' : 'Detect from compose'}
                </Button>
              </div>
              {detectComposeError ? (
                <p className="text-sm text-destructive" role="alert">{detectComposeError}</p>
              ) : null}
              <ServiceMappingEditor
                services={servicesDraft}
                onChange={setServicesDraft}
                onValidationChange={(ok) => setServicesMappingValid(ok)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={!servicesMappingValid || servicesSaveMutation.isPending}
                  loading={servicesSaveMutation.isPending}
                  onClick={() => servicesSaveMutation.mutate()}
                >
                  {servicesSaveMutation.isPending ? 'Saving…' : 'Save services'}
                </Button>
                {servicesDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
              </div>
              {servicesSaveMutation.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {mutationErrorMessage(servicesSaveMutation.error, 'Could not save services.')}
                </p>
              ) : null}
            </section>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="migration-command">
                Migration command
              </label>
              <Input
                id="migration-command"
                mono
                className="mt-1"
                value={migrationCommand}
                onChange={(event) => setMigrationCommand(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="migration-service">
                Migration service
              </label>
              <Input
                id="migration-service"
                mono
                className="mt-1"
                value={migrationService}
                onChange={(event) => setMigrationService(event.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="block text-sm font-medium" htmlFor="health-check-url">
                Health check URL
              </label>
              <Input
                id="health-check-url"
                mono
                className="mt-1"
                value={healthCheckUrl}
                onChange={(event) => setHealthCheckUrl(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={settingsMutation.isPending}
              loading={settingsMutation.isPending}
              onClick={() => settingsMutation.mutate()}
            >
              {settingsMutation.isPending ? 'Saving…' : 'Save settings'}
            </Button>
            {settingsDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
          </div>
          {settingsMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {mutationErrorMessage(settingsMutation.error, 'Could not save settings.')}
            </p>
          ) : null}
          <ProjectDeleteSection
            slug={slug}
            onDelete={handleDelete}
            busy={deleteBusy}
            error={deleteError}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={applyPrompt !== null}
        title={
          applyPrompt === 'password'
            ? 'Deploy to apply the new password'
            : 'Deploy to apply environment changes'
        }
        description={
          applyPrompt === 'password'
            ? 'The database password is already changed. Deploy so the running containers use it.'
            : 'The new values are saved. Deploy so the running containers pick them up.'
        }
        confirmLabel="Deploy"
        cancelLabel="Not now"
        tone="default"
        busy={applyDeployMutation.isPending}
        error={applyDeployError}
        onConfirm={() => applyDeployMutation.mutate()}
        onCancel={() => {
          if (applyPrompt === 'password') {
            setRotateMessage(
              'Password rotated. The running containers keep the old password until you deploy.',
            )
          } else if (applyPrompt === 'env') {
            setEnvSavedMessage(
              'Environment saved. The running containers keep the old values until you deploy.',
            )
          }
          setApplyPrompt(null)
          setApplyDeployError(null)
        }}
      />
    </div>
  )
}
