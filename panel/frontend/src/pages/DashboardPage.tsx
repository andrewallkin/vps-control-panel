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
    <div className="flex w-full flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Live host metrics, Docker disk usage, and container resource consumption.
        </p>
      </div>

      <StatusStrip summary={summaryQuery.data} />
      <WarningsList warnings={summaryQuery.data?.warnings ?? []} />

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
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
            <div className="space-y-3">
              <p className="font-mono text-2xl tracking-tight">
                {formatPercent(current.cpu_percent)}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">1 min</dt>
                  <dd className="font-mono">{current.load1.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">5 min</dt>
                  <dd className="font-mono">{current.load5.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">15 min</dt>
                  <dd className="font-mono">{current.load15.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cores</dt>
                  <dd className="font-mono">{current.cpu_count}</dd>
                </div>
              </dl>
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
            <div className="space-y-3">
              <p className="font-mono text-2xl tracking-tight">
                {formatBytes(current.mem_used)}
                <span className="text-base text-muted-foreground">
                  {' '}
                  / {formatBytes(current.mem_total)}
                </span>
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Available</dt>
                  <dd className="font-mono">{formatBytes(current.mem_available)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Swap</dt>
                  <dd className="font-mono">
                    {formatBytes(current.swap_used)} / {formatBytes(current.swap_total)}
                  </dd>
                </div>
              </dl>
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
            <ul className="space-y-3">
              {current.disks.map((disk) => (
                <li key={disk.path} className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {diskMountLabel(disk.path)}
                    <span className="sr-only"> ({disk.path})</span>
                  </p>
                  <p className="font-mono text-2xl tracking-tight">
                    {formatPercent(disk.percent)}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Used</dt>
                      <dd className="font-mono">{formatBytes(disk.used)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Free</dt>
                      <dd className="font-mono">{formatBytes(disk.free)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            '—'
          )}
        </MetricCard>

        <div className="flex h-full flex-col gap-4">
          <DockerDiskCard
            df={dockerDfQuery.data}
            dataUpdatedAt={dockerDfQuery.dataUpdatedAt}
            isLoading={dockerDfQuery.isLoading}
          />
          <div className="mt-auto">
            <UptimeCard
              uptimeSeconds={current?.uptime_seconds}
              dataUpdatedAt={currentQuery.dataUpdatedAt}
            />
          </div>
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
