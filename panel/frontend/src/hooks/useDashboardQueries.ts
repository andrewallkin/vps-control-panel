import { useQuery } from '@tanstack/react-query'
import {
  fetchContainerMetrics,
  fetchCurrentMetrics,
  fetchDashboardSummary,
  fetchDockerDf,
  fetchMetricsHistory,
} from '../lib/dashboardApi'

export function useCurrentMetricsQuery() {
  return useQuery({
    queryKey: ['metrics', 'current'],
    queryFn: fetchCurrentMetrics,
    refetchInterval: 5000,
  })
}

export function useMetricsHistoryQuery() {
  return useQuery({
    queryKey: ['metrics', 'history', 24],
    queryFn: () => fetchMetricsHistory(24),
    refetchInterval: 60_000,
  })
}

export function useContainerMetricsQuery() {
  return useQuery({
    queryKey: ['metrics', 'containers'],
    queryFn: fetchContainerMetrics,
    refetchInterval: 5000,
  })
}

export function useDockerDfQuery() {
  return useQuery({
    queryKey: ['docker', 'df'],
    queryFn: fetchDockerDf,
    refetchInterval: 60_000,
  })
}

export function useDashboardSummaryQuery() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: fetchDashboardSummary,
    refetchInterval: 30_000,
  })
}
