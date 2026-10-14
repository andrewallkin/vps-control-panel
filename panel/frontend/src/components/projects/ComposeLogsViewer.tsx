import { DownloadSimple, MagnifyingGlass, Pause, Play } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isHealthCheckLog } from '../../lib/healthCheckLog'

export interface ComposeLogsViewerProps {
  slug: string
  service: string
}

function highlightLine(line: string, needle: string) {
  if (!needle.trim()) {
    return line
  }
  const lower = line.toLowerCase()
  const search = needle.toLowerCase()
  const parts: { text: string; match: boolean }[] = []
  let start = 0
  let index = lower.indexOf(search, start)
  while (index !== -1) {
    if (index > start) {
      parts.push({ text: line.slice(start, index), match: false })
    }
    parts.push({ text: line.slice(index, index + search.length), match: true })
    start = index + search.length
    index = lower.indexOf(search, start)
  }
  if (start < line.length) {
    parts.push({ text: line.slice(start), match: false })
  }
  return parts.map((part, i) =>
    part.match ? (
      <mark key={i} className="rounded bg-warning/30 text-foreground">
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  )
}

export function ComposeLogsViewer({ slug, service }: ComposeLogsViewerProps) {
  const [lines, setLines] = useState<string[]>([])
  const [paused, setPaused] = useState(false)
  const [search, setSearch] = useState('')
  const [showHealthChecks, setShowHealthChecks] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    setLines([])
  }, [slug, service])

  useEffect(() => {
    if (paused) {
      sourceRef.current?.close()
      sourceRef.current = null
      return
    }

    const params = new URLSearchParams({
      tail: '200',
      follow: '1',
    })
    if (service) {
      params.set('service', service)
    }
    const source = new EventSource(
      `/api/projects/${encodeURIComponent(slug)}/logs?${params.toString()}`,
    )
    sourceRef.current = source

    source.onmessage = (event) => {
      const text = event.data
      if (!text) {
        return
      }
      setLines((prev) => [...prev, text])
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [slug, service, paused])

  const displayLines = useMemo(
    () => (showHealthChecks ? lines : lines.filter((line) => !isHealthCheckLog(line))),
    [lines, showHealthChecks],
  )

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
    const text = displayLines.join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'logs.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-[12rem] flex-1">
          <MagnifyingGlass
            weight="regular"
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            placeholder="Search log…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground transition-colors duration-200"
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
        >
          {paused ? (
            <Play weight="regular" aria-hidden className="size-4" />
          ) : (
            <Pause weight="regular" aria-hidden className="size-4" />
          )}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={downloadLog}
        >
          <DownloadSimple weight="regular" aria-hidden className="size-4" />
          Download
        </button>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <span id="show-health-checks-label">Health checks</span>
          <span className="text-muted-foreground">{showHealthChecks ? 'On' : 'Off'}</span>
          <span className="relative inline-flex h-6 w-11 items-center">
            <input
              type="checkbox"
              role="switch"
              aria-checked={showHealthChecks}
              aria-labelledby="show-health-checks-label"
              className="peer sr-only"
              checked={showHealthChecks}
              onChange={(event) => setShowHealthChecks(event.target.checked)}
            />
            <span
              aria-hidden
              className="absolute inset-0 rounded-full border border-border bg-muted transition-colors duration-200 peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-0.5 size-5 rounded-full bg-background shadow-sm transition-transform duration-200 peer-checked:translate-x-5"
            />
          </span>
        </label>
      </div>
      <div
        ref={scrollRef}
        data-testid="log-scroll"
        className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground"
        tabIndex={0}
      >
        {displayLines.length === 0 ? (
          <p className="text-muted-foreground">
            {paused
              ? 'Log stream paused.'
              : lines.length > 0
                ? 'Health checks hidden.'
                : 'Waiting for log…'}
          </p>
        ) : (
          displayLines.map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`}>{highlightLine(line, search)}</div>
          ))
        )}
      </div>
    </div>
  )
}
