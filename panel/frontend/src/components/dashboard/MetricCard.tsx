import { Pause, Play } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import {
  oldestSuccessfulUpdateAt,
  SLOW_POLL_STALE_MS,
  useQueryStale,
} from '../../hooks/useQueryStale'
import { useTickingNow } from '../../hooks/useTickingNow'
import { formatSecondsAgo } from '../../lib/format'
import { StaleBadge } from '../StatusBadge'
import { Button, Card, CardBody } from '../ui'
import { MetricChart, type ChartPoint } from './MetricChart'

export interface MetricCardProps {
  title: string
  dataUpdatedAt: number
  /** When set (e.g. metrics history), stale/time-ago follow both queries. */
  historyDataUpdatedAt?: number
  children: ReactNode
  chartData?: ChartPoint[]
  chartValueFormatter?: (value: number) => string
  chartColor?: string
  chartYDomain?: [number | 'auto', number | 'auto']
  tableHeaders: [string, string]
  tableRows: { label: string; value: string }[]
}

export function MetricCard({
  title,
  dataUpdatedAt,
  historyDataUpdatedAt,
  children,
  chartData = [],
  chartValueFormatter,
  chartColor,
  chartYDomain,
  tableHeaders,
  tableRows,
}: MetricCardProps) {
  const [chartPaused, setChartPaused] = useState(false)
  const now = useTickingNow()
  const freshnessTimestamps =
    historyDataUpdatedAt != null
      ? [dataUpdatedAt, historyDataUpdatedAt]
      : [dataUpdatedAt]
  const displayUpdatedAt = oldestSuccessfulUpdateAt(...freshnessTimestamps)
  const isCurrentStale = useQueryStale(dataUpdatedAt)
  const isHistoryStale = useQueryStale(
    historyDataUpdatedAt ?? 0,
    SLOW_POLL_STALE_MS,
  )
  const isStale =
    historyDataUpdatedAt != null
      ? isCurrentStale || isHistoryStale
      : isCurrentStale

  return (
    <Card className="flex h-full flex-col">
      <CardBody className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>updated {formatSecondsAgo(displayUpdatedAt, now)}</span>
            {isStale ? <StaleBadge /> : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={chartPaused}
              onClick={() => setChartPaused((p) => !p)}
              leftIcon={
                chartPaused ? (
                  <Play weight="regular" aria-hidden className="size-4" />
                ) : (
                  <Pause weight="regular" aria-hidden className="size-4" />
                )
              }
            >
              {chartPaused ? 'Resume chart' : 'Pause chart'}
            </Button>
          </div>
        </div>
        <div>{children}</div>
        <div className="relative h-40 w-full shrink-0">
          <MetricChart
            data={chartData}
            paused={chartPaused}
            valueFormatter={chartValueFormatter}
            color={chartColor}
            yDomain={chartYDomain}
          />
        </div>
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">
            Data table
          </summary>
          <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-border bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{tableHeaders[0]}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{tableHeaders[1]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tableRows.map((row) => (
                  <tr key={row.label}>
                    <td className="px-3 py-2 font-mono tabular">{row.label}</td>
                    <td className="px-3 py-2 font-mono tabular">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardBody>
    </Card>
  )
}