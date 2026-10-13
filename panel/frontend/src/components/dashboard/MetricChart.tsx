import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartAxisTicks, historyTimeLabel } from '../../lib/chartData'
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

const metricChartTooltipStyle = {
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 12,
} as const

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
    <div style={metricChartTooltipStyle}>
      <div style={{ color: 'var(--color-foreground)' }}>{lines.timeLabel}</div>
      <div>{lines.valueLabel}</div>
    </div>
  )
}

export function MetricChart({
  data,
  paused,
  valueFormatter = (v) => String(v),
  color = 'var(--color-accent)',
  yDomain,
}: MetricChartProps) {
  const reduced = useReducedMotion()
  const xTicks = chartAxisTicks(data.map((point) => point.time))

  if (paused) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Chart paused.
      </p>
    )
  }

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No history yet.
      </p>
    )
  }

  return (
    <div className="h-40 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickFormatter={axisTickFormatter}
          />
          <YAxis
            domain={yDomain ?? ['auto', 'auto']}
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
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
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={!reduced}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
