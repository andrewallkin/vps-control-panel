import { useMemo } from 'react'
import { ContainersTable } from '../components/dashboard/ContainersTable'
import { DockerDiskCard } from '../components/dashboard/DockerDiskCard'
import { KpiStatRow } from '../components/dashboard/KpiStatRow'
import { MetricCard } from '../components/dashboard/MetricCard'
import { StatusStrip } from '../components/dashboard/StatusStrip'
import { WarningsList } from '../components/dashboard/WarningsList'
import { percentStressClass } from '../components/dashboard/metricThresholds'
import { Alert } from '../components/ui'
import { PageHeader } from '../components/ui/PageHeader'
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

  const memPercent =
    current && current.mem_total > 0
      ? (current.mem_used / current.mem_total) * 100
      : Number.NaN

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Live host metrics, Docker disk usage, and container resource consumption."
      />

      <KpiStatRow
        current={current}
        cpuSparkline={cpuChart}
        memSparkline={memChart}
        diskSparkline={diskChart}
        loading={currentQuery.isPending}
      />

      <StatusStrip
        summary={summaryQuery.data}
        loading={summaryQuery.isPending}
      />
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
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Load (1m)</dt>
                <dd className="font-mono tabular-nums">{current.load1.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Load (5m)</dt>
                <dd className="font-mono tabular-nums">{current.load5.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Load (15m)</dt>
                <dd className="font-mono tabular-nums">{current.load15.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Usage</dt>
                <dd
                  className={`font-mono text-lg tabular-nums ${percentStressClass(current.cpu_percent)}`}
                >
                  {formatPercent(current.cpu_percent)}
                </dd>
              </div>
            </dl>
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
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Available</dt>
                <dd className="font-mono tabular-nums">{formatBytes(current.mem_available)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Swap</dt>
                <dd className="font-mono tabular-nums">
                  {formatBytes(current.swap_used)} / {formatBytes(current.swap_total)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Used</dt>
                <dd
                  className={`font-mono text-lg tabular-nums ${percentStressClass(memPercent)}`}
                >
                  {formatBytes(current.mem_used)}
                  <span className="text-base text-muted-foreground">
                    {' '}
                    / {formatBytes(current.mem_total)}
                  </span>
                </dd>
              </div>
            </dl>
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
                <li key={disk.path} className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {diskMountLabel(disk.path)}
                    <span className="sr-only"> ({disk.path})</span>
                  </p>
                  <p
                    className={`font-mono text-lg tabular-nums ${percentStressClass(disk.percent)}`}
                  >
                    {formatPercent(disk.percent)}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Used</dt>
                      <dd className="font-mono tabular-nums">{formatBytes(disk.used)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Free</dt>
                      <dd className="font-mono tabular-nums">{formatBytes(disk.free)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            '—'
          )}
        </MetricCard>

        <DockerDiskCard
          df={dockerDfQuery.data}
          dataUpdatedAt={dockerDfQuery.dataUpdatedAt}
          isLoading={dockerDfQuery.isLoading}
          className="h-full"
        />
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
        <Alert tone="danger">
          Some dashboard data could not be loaded. Values may be outdated.
        </Alert>
      )}
    </div>
  )
}
