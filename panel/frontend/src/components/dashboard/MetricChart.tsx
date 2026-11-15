import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartAxisTicks, historyTimeLabel } from '../../lib/chartData'
import { CHART_PRIMARY } from './chartColors'
import { buildMetricChartTooltipLines } from './metricChartTooltip'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export interface ChartPoint {
  ts: string
  time: number
  label: string
  value: number
}

export interface MetricChartProps {
  data: ChartPoint[]
  paused: boolean
  valueFormatter?: (value: number) => string
  color?: string
  yDomain?: [number | 'auto', number | 'auto']
}

function axisTickFormatter(tick: number): string {
  return historyTimeLabel(new Date(tick).toISOString())
}

function MetricChartTooltip({
  active,
  payload,
  valueFormatter,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown; value?: unknown }>
  valueFormatter: (value: number) => string
}) {
  if (!active || !payload?.length) {
    return null
  }
  const lines = buildMetricChartTooltipLines(
    payload[0]?.payload as ChartPoint | undefined,
    payload[0]?.value,
    valueFormatter,
  )
  if (!lines) {
    return null
  }
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-sm shadow-[var(--shadow-popover)]">
      <div className="font-medium text-foreground">{lines.timeLabel}</div>
      <div className="mt-0.5 font-mono tabular-nums text-muted-foreground">
        {lines.valueLabel}
      </div>
    </div>
  )
}

export function MetricChart({
  data,
  paused,
  valueFormatter = (v) => String(v),
  color = CHART_PRIMARY,
  yDomain,
}: MetricChartProps) {
  const reduced = useReducedMotion()
  const xTicks = chartAxisTicks(data.map((point) => point.time))
  const gradientId = `metric-fill-${color.replace(/[^a-z0-9]/gi, '')}`

  if (paused) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Chart paused.</p>
    )
  }

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No history yet.</p>
    )
  }

  return (
    <div className="absolute inset-0" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--color-border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            ticks={xTicks}
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 14 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickFormatter={axisTickFormatter}
          />
          <YAxis
            domain={yDomain ?? ['auto', 'auto']}
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 14 }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v) => valueFormatter(Number(v))}
          />
          <Tooltip
            content={({ active, payload }) => (
              <MetricChartTooltip
                active={active}
                payload={payload}
                valueFormatter={valueFormatter}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={!reduced}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
