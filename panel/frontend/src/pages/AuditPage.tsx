import { CheckCircle, MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui'
import { fetchAudit, type AuditEntry } from '../lib/auditApi'
import { formatDateTime } from '../lib/format'

function AuditResultBadge({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <Badge tone="success">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        ok
      </Badge>
    )
  }
  return (
    <Badge tone="danger">
      <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
      failed
    </Badge>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <TR>
      <TD className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatDateTime(entry.time)}
      </TD>
      <TD className="capitalize">{entry.source}</TD>
      <TD className="font-mono text-xs">{entry.operation}</TD>
      <TD>
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Params</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
            {JSON.stringify(entry.params, null, 2)}
          </pre>
        </details>
      </TD>
      <TD>
        <AuditResultBadge ok={entry.ok} />
      </TD>
      <TD className="whitespace-nowrap text-right font-mono text-xs">{entry.duration_ms} ms</TD>
    </TR>
  )
}

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
      <PageHeader
        title="Audit"
        description="Merged panel and agent operation history."
      />

      <section className="space-y-3" aria-labelledby="audit-filters-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="audit-filters-heading" className="text-base font-semibold">
            Filters
          </h2>
          {filtersActive ? (
            <Button variant="ghost" size="sm" className="h-auto px-0" onClick={clearFilters}>
              Clear
            </Button>
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
              <Input
                id="audit-filter-operation"
                type="search"
                value={operationInput}
                placeholder="Exact operation name"
                className="pl-9 font-mono"
                onChange={(event) => setOperationInput(event.target.value)}
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="audit-filter-ok" className="block text-sm font-medium">
              Result
            </label>
            <Select
              id="audit-filter-ok"
              value={okFilter}
              onChange={(event) =>
                setOkFilter(event.target.value as 'all' | 'ok' | 'failed')
              }
            >
              <option value="all">All</option>
              <option value="ok">Ok</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="audit-filter-since" className="block text-sm font-medium">
              Since
            </label>
            <Input
              id="audit-filter-since"
              type="datetime-local"
              value={sinceFilter}
              className="[color-scheme:dark]"
              onChange={(event) => setSinceFilter(event.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <label htmlFor="audit-filter-until" className="block text-sm font-medium">
              Until
            </label>
            <Input
              id="audit-filter-until"
              type="datetime-local"
              value={untilFilter}
              aria-invalid={rangeInvalid}
              className="[color-scheme:dark]"
              invalid={rangeInvalid}
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
          <TableContainer>
            <Table className="min-w-[800px]">
              <THead>
                <TR className="border-b border-border bg-muted/40 hover:bg-muted/40">
                  <TH scope="col" className="font-medium normal-case tracking-normal">Time</TH>
                  <TH scope="col" className="font-medium normal-case tracking-normal">Source</TH>
                  <TH scope="col" className="font-medium normal-case tracking-normal">Operation</TH>
                  <TH scope="col" className="font-medium normal-case tracking-normal">Params</TH>
                  <TH scope="col" className="font-medium normal-case tracking-normal">Result</TH>
                  <TH scope="col" className="text-right font-medium normal-case tracking-normal">Duration</TH>
                </TR>
              </THead>
              <TBody className="divide-y divide-border">
                {auditQuery.isPending ? (
                  <TR className="hover:bg-transparent">
                    <TD colSpan={6}>
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Spinner />
                        Loading audit log…
                      </span>
                    </TD>
                  </TR>
                ) : entries.length === 0 ? (
                  <TR className="hover:bg-transparent">
                    <TD colSpan={6} className="text-muted-foreground">
                      No audit entries match these filters.
                    </TD>
                  </TR>
                ) : (
                  entries.map((entry, index) => (
                    <AuditRow key={`${entry.time}-${entry.operation}-${index}`} entry={entry} />
                  ))
                )}
              </TBody>
            </Table>
          </TableContainer>
          <div ref={loadMoreRef} className="h-4" aria-hidden />
          {auditQuery.isFetchingNextPage ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Loading more…
            </p>
          ) : null}
        </section>
      )}
    </div>
  )
}