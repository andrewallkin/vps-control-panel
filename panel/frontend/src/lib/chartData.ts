import type { HistoryPoint } from './dashboardTypes'
import { formatPercent } from './format'

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

function formatLocalTimeHHmm(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

export function historyTimeLabel(iso: string): string {
  return formatLocalTimeHHmm(new Date(iso))
}

export function chartAxisTicks(timesMs: number[]): number[] {
  if (timesMs.length === 0) {
    return []
  }

  const minMs = Math.min(...timesMs)
  const maxMs = Math.max(...timesMs)
  const span = maxMs - minMs
  const stepHours = span > TWELVE_HOURS_MS ? 3 : 1

  const ticks: number[] = []
  const cursor = new Date(minMs)
  cursor.setMinutes(0, 0, 0)
  const alignedHour = Math.floor(cursor.getHours() / stepHours) * stepHours
  cursor.setHours(alignedHour)

  while (cursor.getTime() <= maxMs) {
    const t = cursor.getTime()
    if (t >= minMs) {
      ticks.push(t)
    }
    cursor.setHours(cursor.getHours() + stepHours)
  }

  if (ticks.length === 0) {
    const fallback = new Date(minMs)
    fallback.setMinutes(0, 0, 0)
    return [fallback.getTime()]
  }

  return ticks
}

export function cpuHistoryChart(points: HistoryPoint[]) {
  return points.map((p) => ({
    ts: p.ts,
    time: Date.parse(p.ts),
    label: historyTimeLabel(p.ts),
    value: p.cpu_percent,
  }))
}

export function memoryHistoryChart(points: HistoryPoint[]) {
  return points.map((p) => ({
    ts: p.ts,
    time: Date.parse(p.ts),
    label: historyTimeLabel(p.ts),
    value: p.mem_total > 0 ? (p.mem_used / p.mem_total) * 100 : 0,
  }))
}

export function diskHistoryChart(points: HistoryPoint[], mountPath: string) {
  return points.map((p) => {
    const disk = p.disks.find((d) => d.path === mountPath)
    return {
      ts: p.ts,
      time: Date.parse(p.ts),
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
