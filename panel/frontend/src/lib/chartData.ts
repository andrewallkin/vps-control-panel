import type { HistoryPoint } from './dashboardTypes'
import { formatPercent } from './format'

export function historyTimeLabel(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function cpuHistoryChart(points: HistoryPoint[]) {
  return points.map((p) => ({
    ts: p.ts,
    label: historyTimeLabel(p.ts),
    value: p.cpu_percent,
  }))
}

export function memoryHistoryChart(points: HistoryPoint[]) {
  return points.map((p) => ({
    ts: p.ts,
    label: historyTimeLabel(p.ts),
    value: p.mem_total > 0 ? (p.mem_used / p.mem_total) * 100 : 0,
  }))
}

export function diskHistoryChart(points: HistoryPoint[], mountPath: string) {
  return points.map((p) => {
    const disk = p.disks.find((d) => d.path === mountPath)
    return {
      ts: p.ts,
      label: historyTimeLabel(p.ts),
      value: disk?.percent ?? 0,
    }
  })
}

export function chartTableRows(
  data: { ts: string; value: number }[],
  formatValue: (v: number) => string,
) {
  return data.map((row) => ({
    label: historyTimeLabel(row.ts),
    value: formatValue(row.value),
  }))
}

export const percentChartFormatter = (v: number) => formatPercent(v, 0)
