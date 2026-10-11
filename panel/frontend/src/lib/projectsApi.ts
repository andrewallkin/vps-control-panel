import { apiJson } from './api'

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
  creation_state: CreationState
  created_at: string
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
  hostnames: ProjectHostname[]
  routes: ProjectRoute[]
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  return apiJson<ProjectSummary[]>('/api/projects')
}

export async function fetchProject(slug: string): Promise<ProjectSummary> {
  return apiJson<ProjectSummary>(`/api/projects/${encodeURIComponent(slug)}`)
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
