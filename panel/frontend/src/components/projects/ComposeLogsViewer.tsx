import { DownloadSimple, MagnifyingGlass, Pause, Play } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Input, Switch } from '../ui'
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
      <mark key={i} className="rounded bg-warning/40 text-zinc-100">
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
    <Card className="space-y-0 p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-[12rem] flex-1">
          <MagnifyingGlass
            weight="regular"
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Search log…"
            className="pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
          leftIcon={
            paused ? (
              <Play weight="regular" aria-hidden className="size-4" />
            ) : (
              <Pause weight="regular" aria-hidden className="size-4" />
            )
          }
        >
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={downloadLog}
          leftIcon={<DownloadSimple weight="regular" aria-hidden className="size-4" />}
        >
          Download
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <span id="show-health-checks-label">Health checks</span>
          <span className="text-muted-foreground">{showHealthChecks ? 'On' : 'Off'}</span>
          <Switch
            checked={showHealthChecks}
            onCheckedChange={setShowHealthChecks}
            aria-labelledby="show-health-checks-label"
          />
        </label>
      </div>
      <div
        ref={scrollRef}
        data-testid="log-scroll"
        className="max-h-96 overflow-auto bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-200"
        tabIndex={0}
      >
        {displayLines.length === 0 ? (
          <p className="text-zinc-400">
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
    </Card>
  )
}