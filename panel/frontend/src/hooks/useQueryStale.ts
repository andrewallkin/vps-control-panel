import { useEffect, useState } from 'react'

const STALE_MS = 15_000

export function useQueryStale(dataUpdatedAt: number): boolean {
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const reference = dataUpdatedAt > 0 ? dataUpdatedAt : mountedAt
  return now - reference > STALE_MS
}

export { STALE_MS }
