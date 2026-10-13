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
    <section className="flex flex-col space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>updated {formatSecondsAgo(displayUpdatedAt, now)}</span>
          {isStale ? <StaleBadge /> : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            aria-pressed={chartPaused}
            onClick={() => setChartPaused((p) => !p)}
          >
            {chartPaused ? (
              <>
                <Play weight="regular" aria-hidden className="size-4" />
                Resume chart
              </>
            ) : (
              <>
                <Pause weight="regular" aria-hidden className="size-4" />
                Pause chart
              </>
            )}
          </button>
        </div>
      </div>
      <div className="font-mono text-lg">{children}</div>
      <div>
        <MetricChart
          data={chartData}
          paused={chartPaused}
          valueFormatter={chartValueFormatter}
          color={chartColor}
          yDomain={chartYDomain}
        />
      </div>
      <details className="group">
        <summary className="cursor-pointer text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground">
          Data table
        </summary>
        <div className="mt-2 max-h-48 overflow-auto rounded-md border border-border">
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
                  <td className="px-3 py-2 font-mono">{row.label}</td>
                  <td className="px-3 py-2 font-mono">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
