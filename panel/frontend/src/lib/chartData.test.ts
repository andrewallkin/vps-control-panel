import { describe, expect, it } from 'vitest'
import { chartAxisTicks, historyTimeLabel } from './chartData'

describe('historyTimeLabel', () => {
  it('formats local time as 24-hour HH:mm without AM/PM', () => {
    const date = new Date(2026, 9, 13, 14, 31)
    const label = historyTimeLabel(date.toISOString())
    expect(label).not.toMatch(/AM|PM/i)
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    expect(label).toBe(`${h}:${m}`)
  })
})

describe('chartAxisTicks', () => {
  it('returns 3-hour aligned ticks within a long local range', () => {
    const y = 2026
    const monthIndex = 9
    const d = 13
    const min = new Date(y, monthIndex, d, 10, 37).getTime()
    const max = new Date(y, monthIndex, d + 1, 5, 37).getTime()

    const ticks = chartAxisTicks([min, max])

    expect(ticks.length).toBeGreaterThan(0)
    for (const tick of ticks) {
      const date = new Date(tick)
      expect(date.getMinutes()).toBe(0)
      expect(date.getSeconds()).toBe(0)
      expect(date.getMilliseconds()).toBe(0)
      expect(date.getHours() % 3).toBe(0)
      expect(tick).toBeGreaterThanOrEqual(min)
      expect(tick).toBeLessThanOrEqual(max)
    }

    const tickTimes = ticks.map((t) => {
      const date = new Date(t)
      return `${date.getHours()}:${date.getMinutes()}`
    })
    expect(tickTimes).not.toContain('10:37')
    expect(tickTimes).not.toContain('14:31')
  })
})
