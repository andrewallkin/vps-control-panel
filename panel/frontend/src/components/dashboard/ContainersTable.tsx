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
import { Button, Card, CardBody, Table, TableContainer, TBody, TD, TH, THead, TR } from '../ui'

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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto w-full justify-end px-1 py-0.5 text-xs font-medium"
      onClick={onClick}
    >
      {label}
      {suffix}
    </Button>
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
    <Card>
      <CardBody className="space-y-3">
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
          <TableContainer className="border-0">
            <Table className="min-w-[40rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="w-[1%] whitespace-nowrap">Project</TH>
                  <TH>Name</TH>
                  <TH className="w-28 whitespace-nowrap text-right">
                    <SortHeaderButton
                      label="CPU"
                      active={sortKey === 'cpu_percent'}
                      direction={sortDirection}
                      onClick={() => toggleSort('cpu_percent')}
                    />
                  </TH>
                  <TH className="w-72 whitespace-nowrap text-right">
                    <SortHeaderButton
                      label="Memory"
                      active={sortKey === 'mem_percent'}
                      direction={sortDirection}
                      onClick={() => toggleSort('mem_percent')}
                    />
                  </TH>
                </TR>
              </THead>
              <TBody>
                {grouped.map((group) =>
                  group.containers.map((row, index) => (
                    <TR key={`${group.project}-${row.name}`} className="hover:bg-muted/50">
                      <TD className="whitespace-nowrap text-muted-foreground">
                        {index === 0 ? group.project : ''}
                      </TD>
                      <TD className="break-all font-mono sm:break-normal">{row.name}</TD>
                      <TD className="whitespace-nowrap text-right font-mono tabular">
                        {formatPercent(row.cpu_percent)}
                      </TD>
                      <TD className="whitespace-nowrap text-right font-mono tabular">
                        {formatBytes(row.mem_used)} / {formatBytes(row.mem_limit)} (
                        {formatPercent(row.mem_percent)})
                      </TD>
                    </TR>
                  )),
                )}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </CardBody>
    </Card>
  )
}