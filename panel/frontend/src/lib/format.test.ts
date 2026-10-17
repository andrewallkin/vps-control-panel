import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDateTime,
  formatPercent,
  formatSecondsAgo,
  formatStartedAt,
  formatUptime,
} from './format'

describe('formatDateTime', () => {
  it('formats local date parts as day month year, HH:mm:ss', () => {
    const iso = new Date(2026, 9, 13, 15, 52, 2).toISOString()
    expect(formatDateTime(iso)).toBe('13 October 2026, 15:52:02')
  })

  it('returns the original string when not parseable', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
})

describe('formatStartedAt', () => {
  it('converts a UTC docker timestamp to SAST', () => {
    expect(formatStartedAt('2026-10-14 16:00:00 +0000 UTC')).toBe(
      '14-10-2026 18:00:00 SAST',
    )
  })

  it('keeps an already-SAST docker timestamp unchanged', () => {
    expect(formatStartedAt('2026-10-14 16:00:00 +0200 SAST')).toBe(
      '14-10-2026 16:00:00 SAST',
    )
  })

  it('returns the original string when not parseable', () => {
    expect(formatStartedAt('4 days ago')).toBe('4 days ago')
  })
})

describe('formatBytes', () => {
  it('formats zero and small values', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats binary steps', () => {
    expect(formatBytes(1024)).toBe('1 KiB')
    expect(formatBytes(1536)).toBe('1.5 KiB')
  })
})

describe('formatPercent', () => {
  it('formats with one decimal by default', () => {
    expect(formatPercent(42.456)).toBe('42.5%')
  })
})

describe('formatSecondsAgo', () => {
  it('returns never when not updated', () => {
    expect(formatSecondsAgo(0, 1000)).toBe('never')
  })

  it('computes elapsed seconds', () => {
    expect(formatSecondsAgo(1000, 5500)).toBe('4s ago')
  })
})

describe('formatUptime', () => {
  it('formats days hours minutes', () => {
    expect(formatUptime(90061)).toBe('1d 1h 1m')
  })

  it('formats sub-day uptime', () => {
    expect(formatUptime(3660)).toBe('1h 1m')
  })
})
