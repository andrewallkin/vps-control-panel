import { Pause, Play } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { useQueryStale } from '../../hooks/useQueryStale'
import { useTickingNow } from '../../hooks/useTickingNow'
import { formatSecondsAgo } from '../../lib/format'
import { StaleBadge } from '../StatusBadge'
import { MetricChart, type ChartPoint } from './MetricChart'

export interface MetricCardProps {
  title: string
  dataUpdatedAt: number
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
  const isStale = useQueryStale(dataUpdatedAt)

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>updated {formatSecondsAgo(dataUpdatedAt, now)}</span>
          {isStale ? <StaleBadge /> : null}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
            aria-pressed={chartPaused}
            onClick={() => setChartPaused((p) => !p)}
          >
            {chartPaused ? (
              <>
                <Play weight="regular" aria-hidden className="size-3.5" />
                Resume chart
              </>
            ) : (
              <>
                <Pause weight="regular" aria-hidden className="size-3.5" />
                Pause chart
              </>
            )}
          </button>
        </div>
      </div>
      <div className="mt-3 font-mono text-lg">{children}</div>
      <div className="mt-4">
        <MetricChart
          data={chartData}
          paused={chartPaused}
          valueFormatter={chartValueFormatter}
          color={chartColor}
          yDomain={chartYDomain}
        />
      </div>
      <details className="mt-3 group">
        <summary className="cursor-pointer text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground">
          Data table
        </summary>
        <div className="mt-2 max-h-48 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">{tableHeaders[0]}</th>
                <th className="px-2 py-1.5 font-medium">{tableHeaders[1]}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <td className="px-2 py-1 font-mono">{row.label}</td>
                  <td className="px-2 py-1 font-mono">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
