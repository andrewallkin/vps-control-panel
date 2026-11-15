import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { Fragment, useState } from 'react'
import { Badge, Button, Card, Table, TableContainer, TBody, TD, TH, THead, TR } from '../ui'
import { deployStatusLabel, deployStatusTone } from '../../lib/deployStatus'
import { formatDateTime, formatDeployDuration, formatIsoRelative } from '../../lib/format'
import type { DeployRow } from '../../lib/projectDeployTypes'

export interface DeployHistoryProps {
  deploys: DeployRow[]
  isPending: boolean
  redeployPending: boolean
  onRedeploy: (deployId: number) => void
}

function formatTagsSummary(row: DeployRow): string {
  const tagEntries = Object.entries(row.tags)
  if (tagEntries.length > 0) {
    return tagEntries.map(([key, value]) => `${key}=${value}`).join(', ')
  }
  if (row.commit) {
    return row.commit.slice(0, 12)
  }
  return '—'
}

export function DeployHistory({
  deploys,
  isPending,
  redeployPending,
  onRedeploy,
}: DeployHistoryProps) {
  const [open, setOpen] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [nowMs] = useState(() => Date.now())

  return (
    <section className="space-y-3">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-2 text-xl font-semibold tracking-tight text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Deploy history
        <span className="text-sm font-normal text-muted-foreground">({deploys.length})</span>
        {open ? (
          <CaretUp weight="regular" aria-hidden className="size-4" />
        ) : (
          <CaretDown weight="regular" aria-hidden className="size-4" />
        )}
      </button>

      {open ? (
        <Card className="overflow-x-auto p-0">
          {!isPending && deploys.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No deploys yet.</p>
          ) : null}
          {deploys.length > 0 ? (
            <TableContainer>
              <Table>
                <THead className="border-b border-border bg-muted/40">
                  <TR className="hover:bg-transparent">
                    <TH scope="col" className="normal-case tracking-normal">Deploy</TH>
                    <TH scope="col" className="normal-case tracking-normal">Status</TH>
                    <TH scope="col" className="normal-case tracking-normal">Started</TH>
                    <TH scope="col" className="normal-case tracking-normal">Duration</TH>
                    <TH scope="col" className="normal-case tracking-normal">Tags / commit</TH>
                    <TH scope="col" className="text-right normal-case tracking-normal">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {deploys.map((row) => {
                    const expanded = expandedId === row.id
                    const logId = `deploy-log-${row.id}`
                    return (
                      <Fragment key={row.id}>
                        <TR>
                          <TD className="font-mono">#{row.id}</TD>
                          <TD>
                            <Badge tone={deployStatusTone(row.status)}>
                              {deployStatusLabel(row.status)}
                            </Badge>
                          </TD>
                          <TD>
                            <time
                              dateTime={row.started_at}
                              title={formatDateTime(row.started_at)}
                              className="text-muted-foreground"
                            >
                              {formatIsoRelative(row.started_at, nowMs)}
                            </time>
                          </TD>
                          <TD className="text-muted-foreground">
                            {formatDeployDuration(row.started_at, row.finished_at, nowMs)}
                          </TD>
                          <TD className="max-w-[12rem] truncate font-mono text-sm" title={formatTagsSummary(row)}>
                            {formatTagsSummary(row)}
                          </TD>
                          <TD className="text-right">
                            <div className="inline-flex flex-wrap justify-end gap-2">
                              {row.log ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-expanded={expanded}
                                  aria-controls={logId}
                                  onClick={() => setExpandedId(expanded ? null : row.id)}
                                >
                                  {expanded ? 'Hide log' : 'Log'}
                                </Button>
                              ) : null}
                              {row.status === 'succeeded' ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={redeployPending}
                                  onClick={() => onRedeploy(row.id)}
                                >
                                  Redeploy
                                </Button>
                              ) : null}
                            </div>
                          </TD>
                        </TR>
                        {expanded && row.log ? (
                          <TR key={`${row.id}-log`}>
                            <TD colSpan={6} className="bg-muted/20 p-3">
                              <pre
                                id={logId}
                                aria-label={`Deploy log #${row.id}`}
                                className="max-h-64 overflow-auto rounded-xl border border-border bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-200"
                              >
                                {row.log}
                              </pre>
                            </TD>
                          </TR>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </TBody>
              </Table>
            </TableContainer>
          ) : null}
        </Card>
      ) : null}
    </section>
  )
}
