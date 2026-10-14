import { useMemo, useState } from 'react'
import {
  groupContainersByProject,
  sortGroupedContainers,
  type ContainerSortKey,
  type SortDirection,
} from '../../lib/containersSort'
import type { ContainerMetrics } from '../../lib/dashboardTypes'
import {
  formatBytes,
  formatPercent,
  formatSecondsAgo,
} from '../../lib/format'
import { useQueryStale } from '../../hooks/useQueryStale'
import { useTickingNow } from '../../hooks/useTickingNow'
import { StaleBadge } from '../StatusBadge'

export interface ContainersTableProps {
  containers: ContainerMetrics[] | undefined
  dataUpdatedAt: number
  isLoading: boolean
}

function SortHeaderButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string
  active: boolean
  direction: SortDirection
  onClick: () => void
}) {
  const suffix = active ? (direction === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <button
      type="button"
      className="inline-flex w-full items-center justify-end gap-1 rounded px-1 py-0.5 text-left text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onClick}
    >
      {label}
      {suffix}
    </button>
  )
}

export function ContainersTable({
  containers,
  dataUpdatedAt,
  isLoading,
}: ContainersTableProps) {
  const [sortKey, setSortKey] = useState<ContainerSortKey>('cpu_percent')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const now = useTickingNow()
  const isStale = useQueryStale(dataUpdatedAt)

  const grouped = useMemo(() => {
    if (!containers?.length) {
      return []
    }
    const groups = groupContainersByProject(containers)
    return sortGroupedContainers(groups, sortKey, sortDirection)
  }, [containers, sortKey, sortDirection])

  function toggleSort(key: ContainerSortKey) {
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('desc')
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Containers</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>updated {formatSecondsAgo(dataUpdatedAt, now)}</span>
          {isStale ? <StaleBadge /> : null}
        </div>
      </div>
      {isLoading && !containers ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !containers?.length ? (
        <p className="text-sm text-muted-foreground">No containers yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th
                  scope="col"
                  className="w-[1%] whitespace-nowrap px-3 py-2 font-medium"
                >
                  Project
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th
                  scope="col"
                  className="w-28 whitespace-nowrap px-4 py-2 text-right font-medium"
                >
                  <SortHeaderButton
                    label="CPU"
                    active={sortKey === 'cpu_percent'}
                    direction={sortDirection}
                    onClick={() => toggleSort('cpu_percent')}
                  />
                </th>
                <th
                  scope="col"
                  className="w-72 whitespace-nowrap px-4 py-2 text-right font-medium"
                >
                  <SortHeaderButton
                    label="Memory"
                    active={sortKey === 'mem_percent'}
                    direction={sortDirection}
                    onClick={() => toggleSort('mem_percent')}
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grouped.map((group) =>
                group.containers.map((row, index) => (
                  <tr key={`${group.project}-${row.name}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {index === 0 ? group.project : ''}
                    </td>
                    <td className="break-all px-3 py-2 font-mono sm:break-normal">
                      {row.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums">
                      {formatPercent(row.cpu_percent)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums">
                      {formatBytes(row.mem_used)} / {formatBytes(row.mem_limit)} (
                      {formatPercent(row.mem_percent)})
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
