import { CheckCircle, Spinner, XCircle } from '@phosphor-icons/react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAudit, type AuditEntry } from '../lib/auditApi'

function formatAuditTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString()
}

function AuditResultBadge({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        ok
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
      <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
      failed
    </span>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <tr>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
        {formatAuditTime(entry.time)}
      </td>
      <td className="px-3 py-2 capitalize">{entry.source}</td>
      <td className="px-3 py-2 font-mono text-xs">{entry.operation}</td>
      <td className="px-3 py-2">
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Params</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {JSON.stringify(entry.params, null, 2)}
          </pre>
        </details>
      </td>
      <td className="px-3 py-2">
        <AuditResultBadge ok={entry.ok} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
        {entry.duration_ms} ms
      </td>
    </tr>
  )
}

export function AuditPage() {
  const [operationFilter, setOperationFilter] = useState('')
  const [okFilter, setOkFilter] = useState<'all' | 'ok' | 'failed'>('all')
  const [sinceFilter, setSinceFilter] = useState('')
  const [untilFilter, setUntilFilter] = useState('')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const okParam = okFilter === 'all' ? undefined : okFilter === 'ok'

  const auditQuery = useInfiniteQuery({
    queryKey: ['audit', operationFilter, okFilter, sinceFilter, untilFilter],
    queryFn: ({ pageParam }) =>
      fetchAudit({
        limit: 50,
        cursor: pageParam,
        operation: operationFilter || undefined,
        ok: okParam,
        since: sinceFilter ? new Date(sinceFilter).toISOString() : undefined,
        until: untilFilter ? new Date(untilFilter).toISOString() : undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    refetchIntervalInBackground: false,
  })

  const entries = useMemo(
    () => auditQuery.data?.pages.flatMap((page) => page.entries) ?? [],
    [auditQuery.data],
  )

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !auditQuery.hasNextPage || auditQuery.isFetchingNextPage) {
      return
    }
    const observer = new IntersectionObserver(
      (records) => {
        if (records[0]?.isIntersecting) {
          void auditQuery.fetchNextPage()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [auditQuery])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Audit</h1>
        <p className="text-sm text-muted-foreground">
          Merged panel and agent operation history.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="audit-filters-heading">
        <h2 id="audit-filters-heading" className="text-base font-semibold">
          Filters
        </h2>
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <label htmlFor="audit-filter-operation" className="block text-sm font-medium">
              Operation
            </label>
            <input
              id="audit-filter-operation"
              type="text"
              value={operationFilter}
              className="w-full min-w-[12rem] rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setOperationFilter(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="audit-filter-ok" className="block text-sm font-medium">
              Result
            </label>
            <select
              id="audit-filter-ok"
              value={okFilter}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) =>
                setOkFilter(event.target.value as 'all' | 'ok' | 'failed')
              }
            >
              <option value="all">All</option>
              <option value="ok">Ok</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="audit-filter-since" className="block text-sm font-medium">
              Since
            </label>
            <input
              id="audit-filter-since"
              type="datetime-local"
              value={sinceFilter}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setSinceFilter(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="audit-filter-until" className="block text-sm font-medium">
              Until
            </label>
            <input
              id="audit-filter-until"
              type="datetime-local"
              value={untilFilter}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setUntilFilter(event.target.value)}
            />
          </div>
        </div>
      </section>

      {auditQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load audit log.
        </p>
      ) : (
        <section className="space-y-3" aria-labelledby="audit-log-heading">
          <h2 id="audit-log-heading" className="text-base font-semibold">
            Events
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Time</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source</th>
                  <th scope="col" className="px-3 py-2 font-medium">Operation</th>
                  <th scope="col" className="px-3 py-2 font-medium">Params</th>
                  <th scope="col" className="px-3 py-2 font-medium">Result</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditQuery.isPending ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Spinner
                          weight="regular"
                          aria-hidden
                          className="size-4 animate-spin"
                        />
                        Loading audit log…
                      </span>
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                      No audit entries match these filters.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry, index) => (
                    <AuditRow key={`${entry.time}-${entry.operation}-${index}`} entry={entry} />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div ref={loadMoreRef} className="h-4" aria-hidden />
          {auditQuery.isFetchingNextPage ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
              Loading more…
            </p>
          ) : null}
        </section>
      )}
    </div>
  )
}
