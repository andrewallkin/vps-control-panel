export interface DiskMetrics {
  path: string
  total: number
  used: number
  free: number
  percent: number
}

export interface CurrentMetrics {
  ts: string
  cpu_percent: number
  cpu_count: number
  load1: number
  load5: number
  load15: number
  mem_total: number
  mem_available: number
  mem_used: number
  mem_percent: number
  swap_total: number
  swap_used: number
  uptime_seconds: number
  disks: DiskMetrics[]
}

export interface HistoryPoint {
  ts: string
  cpu_percent: number
  load1: number
  mem_used: number
  mem_total: number
  swap_used: number
  swap_total: number
  disks: DiskMetrics[]
}

export interface ContainerMetrics {
  name: string
  project: string | null
  cpu_percent: number
  mem_used: number
  mem_limit: number
  mem_percent: number
}

export interface DockerDfCategory {
  size_bytes: number
  reclaimable_bytes: number
  count: number
}

export interface DockerDf {
  images: DockerDfCategory
  containers: DockerDfCategory
  volumes: DockerDfCategory
  build_cache: DockerDfCategory
}

export interface PruneImagesResult {
  reclaimed_bytes: number
}

export interface DashboardWarning {
  level: 'warning' | 'critical'
  code: string
  message: string
}

export interface DashboardSummary {
  backup: {
    last_run: string | null
    overdue: boolean
    failed: boolean
  } | null
  warnings: DashboardWarning[]
  projects: { total: number; up: number; unhealthy: number }
  nearest_cert_expiry: string | null
}
