import type { ReactNode } from 'react'
import type { CurrentMetrics } from '../../lib/dashboardTypes'
import { formatBytes, formatPercent, formatUptime } from '../../lib/format'
import { Card, CardBody, Skeleton } from '../ui'
import { diskMountLabel } from '../../lib/diskLabel'
import { percentStressClass } from './metricThresholds'

export interface KpiStatRowProps {
  current: CurrentMetrics | undefined
  loading?: boolean
}

interface KpiTileProps {
  label: string
  value: ReactNode
  detail?: string
  valueClassName?: string
}

function KpiTile({ label, value, detail, valueClassName = 'text-foreground' }: KpiTileProps) {
  return (
    <Card className="min-w-0 shadow-[var(--shadow-card,0_1px_2px_rgba(24,24,27,0.04),0_8px_24px_rgba(24,24,27,0.06))]">
      <CardBody className="flex flex-col gap-2 p-6">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p
          className={`text-[40px] font-semibold leading-none tabular-nums tracking-tight ${valueClassName}`}
        >
          {value}
        </p>
        {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      </CardBody>
    </Card>
  )
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

export function KpiStatRow({ current, loading }: KpiStatRowProps) {
  if (loading && !current) {
    return (
      <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
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
        detail={current ? `${current.cpu_count} cores` : undefined}
      />
      <KpiTile
        label="Memory"
        value={
          current ? (
            <span className="inline-flex flex-wrap items-baseline">
              <span>{formatBytes(current.mem_used)}</span>
              <span className="whitespace-nowrap text-[22px] font-medium text-muted-foreground">
                {' '}
                / {formatBytes(current.mem_total)}
              </span>
            </span>
          ) : (
            '—'
          )
        }
        valueClassName={current ? percentStressClass(memPercent) : 'text-foreground'}
        detail={current ? `${formatPercent(memPercent)} used` : undefined}
      />
      <KpiTile
        label={primaryDisk ? `Disk (${diskMountLabel(primaryDisk.path)})` : 'Disk'}
        value={primaryDisk ? formatPercent(primaryDisk.percent) : '—'}
        valueClassName={primaryDisk ? percentStressClass(primaryDisk.percent) : 'text-foreground'}
        detail={
          primaryDisk
            ? `${formatBytes(primaryDisk.free)} free`
            : undefined
        }
      />
      <KpiTile
        label="Uptime"
        value={
          current?.uptime_seconds !== undefined ? (
            <span className="whitespace-nowrap text-[32px] font-semibold leading-tight tabular-nums tracking-tight sm:text-[40px]">
              {formatUptime(current.uptime_seconds)}
            </span>
          ) : (
            '—'
          )
        }
        detail="Since last boot"
      />
    </div>
  )
}