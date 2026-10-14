import { CaretDown, CheckCircle, MagnifyingGlass, Spinner, XCircle } from '@phosphor-icons/react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAudit, type AuditEntry } from '../lib/auditApi'
import { formatDateTime } from '../lib/format'

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
        {formatDateTime(entry.time)}
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

const fieldClass =
  'h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors duration-200 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50'

export function AuditPage() {
  const [operationInput, setOperationInput] = useState('')
  const [operationFilter, setOperationFilter] = useState('')
  const [okFilter, setOkFilter] = useState<'all' | 'ok' | 'failed'>('all')
  const [sinceFilter, setSinceFilter] = useState('')
  const [untilFilter, setUntilFilter] = useState('')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setOperationFilter(operationInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [operationInput])

  const okParam = okFilter === 'all' ? undefined : okFilter === 'ok'
  const rangeInvalid =
    sinceFilter !== '' && untilFilter !== '' && new Date(sinceFilter) > new Date(untilFilter)
  const filtersActive =
    operationInput !== '' || okFilter !== 'all' || sinceFilter !== '' || untilFilter !== ''

  const clearFilters = () => {
    setOperationInput('')
    setOperationFilter('')
    setOkFilter('all')
    setSinceFilter('')
    setUntilFilter('')
  }

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
    enabled: !rangeInvalid,
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
    <div className="flex w-full flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Audit</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Merged panel and agent operation history.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="audit-filters-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="audit-filters-heading" className="text-base font-semibold">
            Filters
          </h2>
          {filtersActive ? (
            <button
              type="button"
              className="cursor-pointer text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
              onClick={clearFilters}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(9rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] xl:items-end">
          <div className="min-w-0 space-y-1 sm:col-span-2 xl:col-span-1">
            <label htmlFor="audit-filter-operation" className="block text-sm font-medium">
              Operation
            </label>
            <div className="relative">
              <MagnifyingGlass
                weight="regular"
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id="audit-filter-operation"
                type="search"
                value={operationInput}
                placeholder="Exact operation name"
                className={`${fieldClass} pl-9 font-mono`}
                onChange={(event) => setOperationInput(event.target.value)}
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="audit-filter-ok" className="block text-sm font-medium">
              Result
            </label>
            <div className="relative">
              <select
                id="audit-filter-ok"
                value={okFilter}
                className={`${fieldClass} appearance-none pr-8`}
                onChange={(event) =>
                  setOkFilter(event.target.value as 'all' | 'ok' | 'failed')
                }
              >
                <option value="all">All</option>
                <option value="ok">Ok</option>
                <option value="failed">Failed</option>
              </select>
              <CaretDown
                weight="regular"
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="audit-filter-since" className="block text-sm font-medium">
              Since
            </label>
            <input
              id="audit-filter-since"
              type="datetime-local"
              value={sinceFilter}
              className={fieldClass}
              onChange={(event) => setSinceFilter(event.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="audit-filter-until" className="block text-sm font-medium">
              Until
            </label>
            <input
              id="audit-filter-until"
              type="datetime-local"
              value={untilFilter}
              aria-invalid={rangeInvalid}
              className={fieldClass}
              onChange={(event) => setUntilFilter(event.target.value)}
            />
          </div>
        </div>
        {rangeInvalid ? (
          <p className="text-sm text-destructive" role="alert">
            Since must be earlier than until.
          </p>
        ) : null}
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
