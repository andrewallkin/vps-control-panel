import { useEffect, useState } from 'react'

const STALE_MS = 15_000
/** Refetch interval (60s) plus default stale grace for slow dashboard polls. */
export const SLOW_POLL_STALE_MS = 60_000 + STALE_MS

function useStaleClock(): { now: number; mountedAt: number } {
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return { now, mountedAt }
}

function isTimestampStale(
  dataUpdatedAt: number,
  now: number,
  mountedAt: number,
  staleAfterMs: number,
): boolean {
  const reference = dataUpdatedAt > 0 ? dataUpdatedAt : mountedAt
  return now - reference > staleAfterMs
}

/** Oldest successful fetch time; used when multiple queries feed one UI surface. */
export function oldestSuccessfulUpdateAt(...dataUpdatedAts: number[]): number {
  const successful = dataUpdatedAts.filter((at) => at > 0)
  if (successful.length === 0) return 0
  return Math.min(...successful)
}

export function useQueryStale(
  dataUpdatedAt: number,
  staleAfterMs: number = STALE_MS,
): boolean {
  const { now, mountedAt } = useStaleClock()
  return isTimestampStale(dataUpdatedAt, now, mountedAt, staleAfterMs)
}

/** Stale when any of the queries has not succeeded within the stale window. */
export function useAnyQueryStale(...dataUpdatedAts: number[]): boolean {
  const { now, mountedAt } = useStaleClock()
  return dataUpdatedAts.some((at) =>
    isTimestampStale(at, now, mountedAt, STALE_MS),
  )
}

export { STALE_MS }
