import { historyTimeLabel } from '../../lib/chartData'

export interface MetricChartTooltipPoint {
  ts: string
  time: number
}

export function metricChartTooltipTimeLabel(
  row: MetricChartTooltipPoint | undefined,
): string {
  if (row?.ts) {
    return historyTimeLabel(row.ts)
  }
  if (row?.time != null) {
    return historyTimeLabel(new Date(row.time).toISOString())
  }
  return ''
}

export function buildMetricChartTooltipLines(
  row: MetricChartTooltipPoint | undefined,
  rawValue: unknown,
  valueFormatter: (value: number) => string,
): { timeLabel: string; valueLabel: string } | null {
  if (!row) {
    return null
  }
  const value =
    typeof rawValue === 'number' ? rawValue : Number(rawValue)
  return {
    timeLabel: metricChartTooltipTimeLabel(row),
    valueLabel: valueFormatter(value),
  }
}
