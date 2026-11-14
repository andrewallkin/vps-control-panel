import { DownloadSimple, MagnifyingGlass, Pause, Play } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseJobEndData, parseJobLineData } from '../../lib/jobEvents'
import type { JobEndPayload } from '../../lib/setupApi'
import { Button, Card, Input } from '../ui'

export interface LogViewerProps {
  jobId: string
  onEnd?: (payload: JobEndPayload) => void
}

export function LogViewer({ jobId, onEnd }: LogViewerProps) {
  const [lines, setLines] = useState<string[]>([])
  const [paused, setPaused] = useState(false)
  const [search, setSearch] = useState('')
  const [ended, setEnded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  const onEndRef = useRef(onEnd)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    onEndRef.current = onEnd
  }, [onEnd])

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/events`)

    source.addEventListener('line', (event) => {
      const messageEvent = event as MessageEvent<string>
      const parsed = parseJobLineData(messageEvent.data)
      if (parsed) {
        setLines((prev) => {
          const next = [...prev]
          next[parsed.n] = parsed.text
          return next
        })
      }
    })

    source.addEventListener('end', (event) => {
      const messageEvent = event as MessageEvent<string>
      const payload = parseJobEndData(messageEvent.data)
      setEnded(true)
      if (payload) {
        onEndRef.current?.(payload)
      }
      source.close()
    })

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [jobId])

  const displayLines = useMemo(() => {
    const compact = lines.filter((line) => line !== undefined)
    if (!search.trim()) {
      return compact
    }
    const needle = search.toLowerCase()
    return compact.filter((line) => line.toLowerCase().includes(needle))
  }, [lines, search])

  useEffect(() => {
    if (pausedRef.current) {
      return
    }
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [displayLines])

  const downloadLog = () => {
    const text = lines.filter(Boolean).join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `restore-${jobId}.log`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-[12rem] flex-1">
          <MagnifyingGlass
            weight="regular"
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Search log…"
            value={search}
            className="pl-8"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          leftIcon={
            paused ? (
              <Play weight="regular" aria-hidden className="size-4" />
            ) : (
              <Pause weight="regular" aria-hidden className="size-4" />
            )
          }
        >
          {paused ? 'Resume scroll' : 'Pause scroll'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={downloadLog}
          leftIcon={<DownloadSimple weight="regular" aria-hidden className="size-4" />}
        >
          Download
        </Button>
      </div>
      <div
        ref={scrollRef}
        data-testid="log-scroll"
        className="max-h-72 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground"
        tabIndex={0}
      >
        {displayLines.length === 0 ? (
          <p className="text-muted-foreground">{ended ? 'No log lines yet.' : 'Waiting for log…'}</p>
        ) : (
          displayLines.map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`}>{line}</div>
          ))
        )}
      </div>
    </Card>
  )
}