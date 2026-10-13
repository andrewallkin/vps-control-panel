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
            contentStyle={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--color-foreground)' }}
            labelFormatter={(_label, payload) => {
              const row = payload?.[0]?.payload as ChartPoint | undefined
              if (row?.ts) {
                return historyTimeLabel(row.ts)
              }
              if (row?.time != null) {
                return historyTimeLabel(new Date(row.time).toISOString())
              }
              return ''
            }}
            formatter={(value) => [
              valueFormatter(typeof value === 'number' ? value : Number(value)),
              '',
            ]}
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
