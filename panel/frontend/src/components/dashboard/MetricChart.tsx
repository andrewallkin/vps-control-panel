import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export interface ChartPoint {
  ts: string
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

export function MetricChart({
  data,
  paused,
  valueFormatter = (v) => String(v),
  color = '#22C55E',
  yDomain,
}: MetricChartProps) {
  const reduced = useReducedMotion()

  if (paused) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Chart paused
      </p>
    )
  }

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No history yet
      </p>
    )
  }

  return (
    <div className="h-40 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#475569" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#94A3B8', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#475569' }}
            minTickGap={24}
          />
          <YAxis
            domain={yDomain ?? ['auto', 'auto']}
            tick={{ fill: '#94A3B8', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v) => valueFormatter(Number(v))}
          />
          <Tooltip
            contentStyle={{
              background: '#1B2336',
              border: '1px solid #475569',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: '#F8FAFC' }}
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
