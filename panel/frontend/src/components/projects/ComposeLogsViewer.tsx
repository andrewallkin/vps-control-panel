import { DownloadSimple, MagnifyingGlass, Pause, Play } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'

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
  const [connected, setConnected] = useState(false)
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
      setConnected(false)
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
    setConnected(true)

    source.onmessage = (event) => {
      const text = event.data
      if (!text) {
        return
      }
      setLines((prev) => [...prev, text])
    }

    source.onerror = () => {
      source.close()
      setConnected(false)
    }

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [slug, service, paused])

  useEffect(() => {
    if (pausedRef.current) {
      return
    }
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [lines])

  const displayLines = useMemo(() => lines, [lines])

  const downloadLog = () => {
    const text = lines.join('\n')
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
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
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
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
          onClick={downloadLog}
        >
          <DownloadSimple weight="regular" aria-hidden className="size-4" />
          Download
        </button>
      </div>
      <div
        ref={scrollRef}
        data-testid="log-scroll"
        className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground"
        tabIndex={0}
      >
        {displayLines.length === 0 ? (
          <p className="text-muted-foreground">
            {connected ? 'Waiting for log…' : 'Log stream paused.'}
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
