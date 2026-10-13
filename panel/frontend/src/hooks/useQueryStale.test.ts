import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SLOW_POLL_STALE_MS,
  STALE_MS,
  oldestSuccessfulUpdateAt,
  useAnyQueryStale,
  useQueryStale,
} from './useQueryStale'

describe('oldestSuccessfulUpdateAt', () => {
  it('returns the minimum of successful update times', () => {
    expect(oldestSuccessfulUpdateAt(100, 50, 200)).toBe(50)
    expect(oldestSuccessfulUpdateAt(0, 80)).toBe(80)
    expect(oldestSuccessfulUpdateAt(0, 0)).toBe(0)
  })
})

describe('useAnyQueryStale', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is stale when any query exceeds the threshold', () => {
    const fresh = Date.now()
    const old = fresh - STALE_MS - 1000
    const { result } = renderHook(() => useAnyQueryStale(fresh, old))
    expect(result.current).toBe(true)
  })

  it('is not stale when all queries are fresh', () => {
    const t = Date.now()
    const { result } = renderHook(() => useAnyQueryStale(t, t - 5000))
    expect(result.current).toBe(false)
  })
})

describe('useQueryStale', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not stale before threshold without successful update', () => {
    const { result } = renderHook(() => useQueryStale(0))
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(STALE_MS - 1)
    })
    expect(result.current).toBe(false)
  })

  it('becomes stale after 15s without success', () => {
    const { result } = renderHook(() => useQueryStale(0))
    act(() => {
      vi.advanceTimersByTime(STALE_MS + 1000)
    })
    expect(result.current).toBe(true)
  })

  it('marks a 20s-old timestamp stale at 15s threshold but not at 75s', () => {
    const updatedAt = Date.now() - 20_000
    const { result: fast } = renderHook(() => useQueryStale(updatedAt, STALE_MS))
    expect(fast.current).toBe(true)
    const { result: slow } = renderHook(() =>
      useQueryStale(updatedAt, SLOW_POLL_STALE_MS),
    )
    expect(slow.current).toBe(false)
  })

  it('uses custom threshold when dataUpdatedAt is 0', () => {
    const { result } = renderHook(() => useQueryStale(0, SLOW_POLL_STALE_MS))
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(SLOW_POLL_STALE_MS - 1000)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current).toBe(true)
  })

  it('resets when data updates', () => {
    const updatedAt = Date.now()
    const { result, rerender } = renderHook(
      ({ at }: { at: number }) => useQueryStale(at),
      { initialProps: { at: updatedAt } },
    )
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current).toBe(false)
    rerender({ at: Date.now() })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(STALE_MS)
    })
    expect(result.current).toBe(true)
  })
})
