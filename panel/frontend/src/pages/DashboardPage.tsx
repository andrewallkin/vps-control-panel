import { useMemo } from 'react'
import { ContainersTable } from '../components/dashboard/ContainersTable'
import { DockerDiskCard } from '../components/dashboard/DockerDiskCard'
import { MetricCard } from '../components/dashboard/MetricCard'
import { StatusStrip } from '../components/dashboard/StatusStrip'
import { UptimeCard } from '../components/dashboard/UptimeCard'
import { WarningsList } from '../components/dashboard/WarningsList'
import {
  useContainerMetricsQuery,
  useCurrentMetricsQuery,
  useDashboardSummaryQuery,
  useDockerDfQuery,
  useMetricsHistoryQuery,
} from '../hooks/useDashboardQueries'
import {
  chartTableRows,
  cpuHistoryChart,
  diskHistoryChart,
  memoryHistoryChart,
  percentChartFormatter,
} from '../lib/chartData'
import { diskMountLabel } from '../lib/diskLabel'
import { formatBytes, formatPercent } from '../lib/format'

export function DashboardPage() {
  const currentQuery = useCurrentMetricsQuery()
  const historyQuery = useMetricsHistoryQuery()
  const containersQuery = useContainerMetricsQuery()
  const dockerDfQuery = useDockerDfQuery()
  const summaryQuery = useDashboardSummaryQuery()

  const current = currentQuery.data
  const historyPoints = historyQuery.data

  const cpuChart = useMemo(
    () => cpuHistoryChart(historyPoints ?? []),
    [historyPoints],
  )
  const memChart = useMemo(
    () => memoryHistoryChart(historyPoints ?? []),
    [historyPoints],
  )
  const primaryDisk = current?.disks[0]?.path
  const diskChart = useMemo(
    () =>
      primaryDisk && historyPoints
        ? diskHistoryChart(historyPoints, primaryDisk)
        : [],
    [historyPoints, primaryDisk],
  )

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>

      <StatusStrip summary={summaryQuery.data} />
      <WarningsList warnings={summaryQuery.data?.warnings ?? []} />

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricCard
          title="CPU"
          dataUpdatedAt={currentQuery.dataUpdatedAt}
          historyDataUpdatedAt={historyQuery.dataUpdatedAt}
          chartData={cpuChart}
          chartValueFormatter={percentChartFormatter}
          chartColor="var(--color-accent)"
          chartYDomain={[0, 100]}
          tableHeaders={['Time', 'CPU %']}
          tableRows={chartTableRows(cpuChart, percentChartFormatter)}
        >
          {current ? (
            <div className="space-y-1 text-base">
              <p>{formatPercent(current.cpu_percent)}</p>
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground">
                  1 min {current.load1.toFixed(2)} · 5 min{' '}
                  {current.load5.toFixed(2)} · 15 min{' '}
                  {current.load15.toFixed(2)} · {current.cpu_count} cores
                </span>
              </p>
            </div>
          ) : (
            '—'
          )}
        </MetricCard>

        <MetricCard
          title="Memory"
          dataUpdatedAt={currentQuery.dataUpdatedAt}
          historyDataUpdatedAt={historyQuery.dataUpdatedAt}
          chartData={memChart}
          chartValueFormatter={percentChartFormatter}
          chartColor="var(--color-foreground)"
          chartYDomain={[0, 100]}
          tableHeaders={['Time', 'Used %']}
          tableRows={chartTableRows(memChart, percentChartFormatter)}
        >
          {current ? (
            <div className="space-y-1 text-base">
              <p>
                {formatBytes(current.mem_used)} / {formatBytes(current.mem_total)}
              </p>
              <p className="text-sm text-muted-foreground">
                available {formatBytes(current.mem_available)} · swap{' '}
                {formatBytes(current.swap_used)} / {formatBytes(current.swap_total)}
              </p>
            </div>
          ) : (
            '—'
          )}
        </MetricCard>

        <MetricCard
          title="Disk"
          dataUpdatedAt={currentQuery.dataUpdatedAt}
          historyDataUpdatedAt={historyQuery.dataUpdatedAt}
          chartData={diskChart}
          chartValueFormatter={percentChartFormatter}
          chartColor="var(--color-warning)"
          chartYDomain={[0, 100]}
          tableHeaders={['Time', 'Used %']}
          tableRows={chartTableRows(diskChart, percentChartFormatter)}
        >
          {current?.disks.length ? (
            <ul className="space-y-2 text-sm">
              {current.disks.map((disk) => (
                <li key={disk.path} className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono">
                    {diskMountLabel(disk.path)}
                    <span className="sr-only"> ({disk.path})</span>
                  </span>
                  <span>
                    {formatBytes(disk.used)} used · {formatBytes(disk.free)} free (
                    {formatPercent(disk.percent)})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            '—'
          )}
        </MetricCard>

        <div className="flex flex-col gap-4">
          <DockerDiskCard
            df={dockerDfQuery.data}
            dataUpdatedAt={dockerDfQuery.dataUpdatedAt}
            isLoading={dockerDfQuery.isLoading}
          />
          <UptimeCard
            uptimeSeconds={current?.uptime_seconds}
            dataUpdatedAt={currentQuery.dataUpdatedAt}
          />
        </div>
      </div>

      <ContainersTable
        containers={containersQuery.data}
        dataUpdatedAt={containersQuery.dataUpdatedAt}
        isLoading={containersQuery.isLoading}
      />

      {(currentQuery.isError ||
        historyQuery.isError ||
        containersQuery.isError ||
        dockerDfQuery.isError ||
        summaryQuery.isError) && (
        <p className="text-sm text-destructive" role="alert">
          Some dashboard data could not be loaded. Values may be outdated.
        </p>
      )}
    </div>
  )
}
