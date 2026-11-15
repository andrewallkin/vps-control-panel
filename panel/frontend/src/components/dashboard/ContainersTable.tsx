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
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../ui'
import { TableSkeletonRows } from './TableSkeletonRows'
import { Package } from '@phosphor-icons/react'

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
      className="h-auto w-full justify-end px-1 py-0.5 text-sm font-semibold"
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
    <Card className="overflow-hidden shadow-[var(--shadow-card,0_1px_2px_rgba(24,24,27,0.04),0_8px_24px_rgba(24,24,27,0.06))]">
      <CardBody className="space-y-3 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-5">
          <h2 className="text-xl font-semibold">Containers</h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>updated {formatSecondsAgo(dataUpdatedAt, now)}</span>
            {isStale ? <StaleBadge /> : null}
          </div>
        </div>
        {isLoading && !containers ? (
          <TableContainer className="border-0 px-2">
            <Table className="min-w-[45rem] text-base">
              <THead>
                <TR className="hover:bg-transparent text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <TH scope="col" className="w-[1%] whitespace-nowrap px-6 py-3">
                    Project
                  </TH>
                  <TH scope="col" className="px-4 py-3">
                    Name
                  </TH>
                  <TH scope="col" className="whitespace-nowrap px-4 py-3">
                    Status
                  </TH>
                  <TH scope="col" className="w-28 whitespace-nowrap px-4 py-3 text-right">
                    CPU
                  </TH>
                  <TH scope="col" className="w-72 whitespace-nowrap px-6 py-3 text-right">
                    Memory
                  </TH>
                </TR>
              </THead>
              <TBody>
                <TableSkeletonRows columns={5} />
              </TBody>
            </Table>
          </TableContainer>
        ) : !containers?.length ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<Package weight="regular" className="size-8" aria-hidden />}
              title="No containers yet."
            />
          </div>
        ) : (
          <TableContainer className="border-0 px-2">
            <Table className="min-w-[45rem] text-base">
              <THead>
                <TR className="hover:bg-transparent text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <TH scope="col" className="w-[1%] whitespace-nowrap px-6 py-3">
                    Project
                  </TH>
                  <TH scope="col" className="px-4 py-3">
                    Name
                  </TH>
                  <TH scope="col" className="whitespace-nowrap px-4 py-3">
                    Status
                  </TH>
                  <TH scope="col" className="w-28 whitespace-nowrap px-4 py-3 text-right">
                    <SortHeaderButton
                      label="CPU"
                      active={sortKey === 'cpu_percent'}
                      direction={sortDirection}
                      onClick={() => toggleSort('cpu_percent')}
                    />
                  </TH>
                  <TH scope="col" className="w-72 whitespace-nowrap px-6 py-3 text-right">
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
                    <TR key={`${group.project}-${row.name}`} className="hover:bg-accent-soft/45">
                      <TD className="whitespace-nowrap px-6 py-4 text-muted-foreground">
                        {index === 0 ? group.project : ''}
                      </TD>
                      <TD className="break-all px-4 py-4 font-medium sm:break-normal">
                        {row.name}
                      </TD>
                      <TD className="whitespace-nowrap px-4 py-4">
                        <Badge tone="success" dot>
                          Running
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                        {formatPercent(row.cpu_percent)}
                      </TD>
                      <TD className="whitespace-nowrap px-6 py-4 text-right tabular-nums">
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
