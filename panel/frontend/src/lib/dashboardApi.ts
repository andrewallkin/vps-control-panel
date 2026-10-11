import { apiJson } from './api'
import type {
  ContainerMetrics,
  CurrentMetrics,
  DashboardSummary,
  DockerDf,
  HistoryPoint,
  PruneImagesResult,
} from './dashboardTypes'

export function fetchCurrentMetrics(): Promise<CurrentMetrics> {
  return apiJson<CurrentMetrics>('/api/metrics/current')
}

export function fetchMetricsHistory(hours = 24): Promise<HistoryPoint[]> {
  return apiJson<HistoryPoint[]>(`/api/metrics/history?hours=${hours}`)
}

export function fetchContainerMetrics(): Promise<ContainerMetrics[]> {
  return apiJson<ContainerMetrics[]>('/api/metrics/containers')
}

export function fetchDockerDf(): Promise<DockerDf> {
  return apiJson<DockerDf>('/api/docker/df')
}

export function pruneUnusedImages(): Promise<PruneImagesResult> {
  return apiJson<PruneImagesResult>('/api/docker/prune-images', {
    method: 'POST',
  })
}

export function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiJson<DashboardSummary>('/api/dashboard/summary')
}
