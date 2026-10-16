import { useEffect, useState } from 'react'
import { parseJobLineData } from './jobEvents'

export interface JobLogStream {
  lines: string[]
  ended: boolean
}

interface JobLogState {
  jobId: string | null
  lines: string[]
  ended: boolean
}

export function useJobLogStream(jobId: string | null): JobLogStream {
  const [state, setState] = useState<JobLogState>({ jobId: null, lines: [], ended: false })

  useEffect(() => {
    if (!jobId) {
      return
    }
    const source = new EventSource(`/api/jobs/${jobId}/events`)

    source.addEventListener('line', (event) => {
      const messageEvent = event as MessageEvent<string>
      const parsed = parseJobLineData(messageEvent.data)
      if (parsed) {
        setState((prev) => {
          if (prev.jobId !== jobId) {
            const fresh: string[] = []
            fresh[parsed.n] = parsed.text
            return { jobId, lines: fresh, ended: false }
          }
          const next = [...prev.lines]
          next[parsed.n] = parsed.text
          return { ...prev, lines: next }
        })
      }
    })

    source.addEventListener('end', () => {
      setState((prev) =>
        prev.jobId === jobId
          ? { ...prev, ended: true }
          : { jobId, lines: [], ended: true },
      )
      source.close()
    })

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [jobId])

  return {
    lines: state.jobId === jobId ? state.lines : [],
    ended: state.jobId === jobId && state.ended,
  }
}
