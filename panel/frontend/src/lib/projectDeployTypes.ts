export interface RegistryTagOption {
  name: string
  sha: string
  pushed_at: string | null
}

export interface ProjectServiceTags {
  service: string
  image_env_var: string
  tags: RegistryTagOption[] | string[]
}

export interface DeployRow {
  id: number
  status: string
  trigger: string
  tags: Record<string, string>
  commit: string | null
  started_at: string
  finished_at: string | null
  log: string
}

export interface ComposePsService {
  service?: string
  name?: string
  container?: string
  state: string
  health: string
  image: string
  started_at: string
}

export interface ProjectEnvEntry {
  key: string
  value: string
}

export interface ProjectEnvResponse {
  entries: ProjectEnvEntry[]
}

export interface ProjectDumpRow {
  name: string
  size_bytes: number
  created_at: string
}

export interface DeleteProjectPayload {
  confirm: string
  drop_database: boolean
  remove_dns: boolean
}
