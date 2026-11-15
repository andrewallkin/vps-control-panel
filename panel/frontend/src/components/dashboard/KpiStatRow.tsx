import type { CurrentMetrics } from '../../lib/dashboardTypes'
import { formatBytes, formatPercent, formatUptime } from '../../lib/format'
import { Card, CardBody, Skeleton } from '../ui'
import { diskMountLabel } from '../../lib/diskLabel'
import type { ChartPoint } from './MetricChart'
import { MiniSparkline } from './MiniSparkline'
import { percentStressClass } from './metricThresholds'

export interface KpiStatRowProps {
  current: CurrentMetrics | undefined
  cpuSparkline: ChartPoint[]
  memSparkline: ChartPoint[]
  diskSparkline: ChartPoint[]
  loading?: boolean
}

interface KpiTileProps {
  label: string
  value: string
  detail?: string
  valueClassName?: string
  sparkline?: ChartPoint[]
  sparkColor?: string
  deltaLabel?: string | null
}

function KpiTile({
  label,
  value,
  detail,
  valueClassName = 'text-foreground',
  sparkline,
  sparkColor,
  deltaLabel,
}: KpiTileProps) {
  return (
    <Card className="min-w-0">
      <CardBody className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {sparkline?.length ? (
            <MiniSparkline data={sparkline} color={sparkColor} className="shrink-0 opacity-80" />
          ) : null}
        </div>
        <p className={`font-mono text-2xl tabular-nums tracking-tight ${valueClassName}`}>{value}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        {deltaLabel ? (
          <p className="text-xs tabular-nums text-muted-foreground">{deltaLabel}</p>
        ) : null}
      </CardBody>
    </Card>
  )
}

function sparkDelta(data: ChartPoint[]): string | null {
  if (data.length < 2) {
    return null
  }
  const first = data[0]?.value
  const last = data[data.length - 1]?.value
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return null
  }
  const diff = last - first
  if (Math.abs(diff) < 0.05) {
    return null
  }
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff.toFixed(1)} pts`
}

function KpiSkeleton() {
  return (
    <Card>
      <CardBody className="space-y-2 p-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-20" />
      </CardBody>
    </Card>
  )
}

export function KpiStatRow({
  current,
  cpuSparkline,
  memSparkline,
  diskSparkline,
  loading,
}: KpiStatRowProps) {
  if (loading && !current) {
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
      </div>
    )
  }

  const primaryDisk = current?.disks[0]
  const memPercent =
    current && current.mem_total > 0
      ? (current.mem_used / current.mem_total) * 100
      : Number.NaN

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Host summary">
      <KpiTile
        label="CPU"
        value={current ? formatPercent(current.cpu_percent) : '—'}
        valueClassName={current ? percentStressClass(current.cpu_percent) : 'text-foreground'}
        sparkline={cpuSparkline}
        sparkColor="var(--color-accent)"
        deltaLabel={sparkDelta(cpuSparkline)}
        detail={current ? `${current.cpu_count} cores` : undefined}
      />
      <KpiTile
        label="Memory"
        value={
          current
            ? `${formatBytes(current.mem_used)} / ${formatBytes(current.mem_total)}`
            : '—'
        }
        valueClassName={current ? percentStressClass(memPercent) : 'text-foreground'}
        sparkline={memSparkline}
        sparkColor="var(--color-foreground)"
        deltaLabel={sparkDelta(memSparkline)}
        detail={current ? `${formatPercent(memPercent)} used` : undefined}
      />
      <KpiTile
        label={primaryDisk ? `Disk (${diskMountLabel(primaryDisk.path)})` : 'Disk'}
        value={primaryDisk ? formatPercent(primaryDisk.percent) : '—'}
        valueClassName={primaryDisk ? percentStressClass(primaryDisk.percent) : 'text-foreground'}
        sparkline={diskSparkline}
        sparkColor="var(--color-warning)"
        deltaLabel={sparkDelta(diskSparkline)}
        detail={
          primaryDisk
            ? `${formatBytes(primaryDisk.free)} free`
            : undefined
        }
      />
      <KpiTile
        label="Uptime"
        value={
          current?.uptime_seconds !== undefined
            ? formatUptime(current.uptime_seconds)
            : '—'
        }
        detail="Since last boot"
      />
    </div>
  )
}
