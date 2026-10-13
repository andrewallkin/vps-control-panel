import { describe, expect, it } from 'vitest'
import { buildMetricChartTooltipLines } from './metricChartTooltip'

describe('buildMetricChartTooltipLines', () => {
  it('returns 24-hour time and formatted value on separate lines', () => {
    const date = new Date(2026, 9, 13, 3, 18)
    const row = {
      ts: date.toISOString(),
      time: date.getTime(),
    }

    const lines = buildMetricChartTooltipLines(row, 13, (v) => `${v}%`)

    expect(lines).not.toBeNull()
    expect(lines!.timeLabel).toBe('03:18')
    expect(lines!.valueLabel).toBe('13%')
    expect(lines!.valueLabel).not.toMatch(/^:/)
  })

  it('returns null when there is no chart point', () => {
    expect(
      buildMetricChartTooltipLines(undefined, 13, (v) => `${v}%`),
    ).toBeNull()
  })
})
