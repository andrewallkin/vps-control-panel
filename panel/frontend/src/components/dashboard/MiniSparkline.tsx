import type { ChartPoint } from './MetricChart'

export interface MiniSparklineProps {
  data: ChartPoint[]
  color?: string
  className?: string
}

export function MiniSparkline({
  data,
  color = 'var(--color-accent)',
  className = '',
}: MiniSparklineProps) {
  if (data.length < 2) {
    return <span className={`inline-block h-6 w-14 ${className}`} aria-hidden />
  }

  const values = data.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const width = 56
  const height = 24
  const step = width / (values.length - 1)

  const points = values
    .map((value, index) => {
      const x = index * step
      const y = height - ((value - min) / range) * (height - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        opacity={0.85}
      />
    </svg>
  )
}
