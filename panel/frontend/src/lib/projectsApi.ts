import { ApiError, apiFetch, apiJson } from './api'
import type {
  ComposePsService,
  DeleteProjectPayload,
  DeployRow,
  ProjectDumpRow,
  ProjectEnvResponse,
  ProjectServiceTags,
} from './projectDeployTypes'

export interface CreationStep {
  name: string
  status: string
  error: string | null
}

export interface CreationState {
  status: 'running' | 'failed' | 'ready' | string
  steps: CreationStep[]
  public_key?: string | null
}

export interface ProjectHostname {
  domain: string
  subdomain: string
  kind: 'primary' | 'alias' | 'redirect'
}

export interface ProjectRoute {
  path_prefix: string
  port_env_var: string
  max_body_mb?: number
  read_timeout_s?: number
  send_timeout_s?: number
  streaming?: boolean
  websocket?: boolean
  pass_authorization?: boolean
}

export interface ProjectServiceInput {
  service_name: string
  image_env_var: string
  tag_prefix: string
}

export interface ProjectServiceRow extends ProjectServiceInput {
  current_tag: string | null
}

export interface ProjectSummary {
  slug: string
  display_name: string
  repo_url: string
  branch: string
  compose_file: string
  deploy_mode: 'image' | 'build'
  docker_hub_repo: string | null
  database_mode: 'none' | 'new' | 'adopted'
  db_name: string | null
  db_user: string | null
  write_database_url: boolean
  migration_command: string | null
  migration_service: string | null
  health_check_url: string | null
  creation_state: CreationState
  created_at: string
}

export interface ProjectDetail extends ProjectSummary {
  hostnames: ProjectHostname[]
  routes: ProjectRoute[]
  services: ProjectServiceRow[]
}

export interface AdoptableDatabase {
  name: string
  owner: string
  size_bytes: number
  attached_slug: string | null
}

export interface CreateProjectPayload {
  slug: string
  display_name: string
  repo: string
  branch: string
  compose_file: string
  deploy_mode: 'image' | 'build'
  docker_hub_repo?: string | null
  database_mode: 'none' | 'new' | 'adopted'
  db_name?: string | null
  db_user?: string | null
  write_database_url: boolean
  user_env?: string | null
  migration_service?: string | null
  migration_command?: string | null
  hostnames: ProjectHostname[]
  routes: ProjectRoute[]
  services?: ProjectServiceInput[]
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  return apiJson<ProjectSummary[]>('/api/projects')
}

export async function fetchProject(slug: string): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>(`/api/projects/${encodeURIComponent(slug)}`)
}

export interface ComposeDiscoveredService {
  name: string
  image: string
  image_var: string | null
}

export async function fetchComposeServices(slug: string): Promise<{
  services: ComposeDiscoveredService[]
  networks: string[]
  warning: string | null
}> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/compose-services`)
}

export async function putProjectServices(
  slug: string,
  services: ProjectServiceInput[],
): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>(`/api/projects/${encodeURIComponent(slug)}/services`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      services: services.map((row) => ({
        service_name: row.service_name,
        image_env_var: row.image_env_var,
        tag_prefix: row.tag_prefix,
      })),
    }),
  })
}

export async function patchProjectSettings(
  slug: string,
  payload: {
    migration_command?: string | null
    migration_service?: string | null
    health_check_url?: string | null
  },
): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>(`/api/projects/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteProject(
  slug: string,
  payload: DeleteProjectPayload,
): Promise<void> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, body)
  }
}

export async function fetchComposePs(slug: string): Promise<{ services: ComposePsService[] }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/compose/ps`)
}

export async function fetchProjectTags(slug: string): Promise<{ services: ProjectServiceTags[] }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/tags`)
}

export async function fetchProjectDeploys(slug: string): Promise<DeployRow[]> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/deploys`)
}

export async function startProjectDeploy(
  slug: string,
  body: { tags?: Record<string, string>; build?: boolean; run_migrations?: boolean },
): Promise<{ id: number; status: string }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function migrateProject(
  slug: string,
): Promise<{ job_id: string }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/migrate`, {
    method: 'POST',
  })
}

export async function redeployDeploy(deployId: number): Promise<{ id: number; status: string }> {
  return apiJson(`/api/deploys/${deployId}/redeploy`, {
    method: 'POST',
  })
}

export async function fetchProjectEnv(slug: string): Promise<ProjectEnvResponse> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/env`)
}

export async function putProjectEnv(slug: string, content: string): Promise<unknown> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/env`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

export async function patchProjectEnv(
  slug: string,
  set: Record<string, string>,
  unset: string[] = [],
): Promise<unknown> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/env`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set, unset }),
  })
}

export async function restartProjectCompose(slug: string): Promise<{ restarted?: boolean }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/compose/restart`, {
    method: 'POST',
  })
}

export async function putProjectRouting(
  slug: string,
  body: {
    hostnames: ProjectHostname[]
    routes: ProjectRoute[]
  },
): Promise<{ status: string }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/routing`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchProjectDumps(slug: string): Promise<ProjectDumpRow[]> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/dumps`)
}

export async function rotateProjectDatabase(slug: string): Promise<{ restart_required: boolean }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/database/rotate`, {
    method: 'POST',
  })
}

export function projectDumpDownloadUrl(slug: string, name: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/dumps/${encodeURIComponent(name)}`
}

export async function fetchAdoptableDatabases(): Promise<AdoptableDatabase[]> {
  return apiJson<AdoptableDatabase[]>('/api/databases')
}

export async function createProject(
  payload: CreateProjectPayload,
): Promise<{ slug: string; creation_state: CreationState }> {
  return apiJson('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function retryProjectCreate(
  slug: string,
): Promise<{ slug: string; creation_state: CreationState }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/retry-create`, {
    method: 'POST',
  })
}

export async function testProjectAccess(slug: string): Promise<unknown> {
  return apiJson('/api/projects/test-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
}

export async function fetchDeployKeyPublic(slug: string): Promise<{ public_key: string | null }> {
  return apiJson(`/api/projects/${encodeURIComponent(slug)}/deploy-key`)
}

export function projectCreationStatusLabel(status: string): string {
  if (status === 'ready') {
    return 'Ready'
  }
  if (status === 'failed') {
    return 'Failed'
  }
  if (status === 'running') {
    return 'Running'
  }
  return status
}
