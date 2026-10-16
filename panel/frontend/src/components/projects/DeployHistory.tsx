import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { useState } from 'react'
import type { DeployRow } from '../../lib/projectDeployTypes'

export interface DeployHistoryProps {
  deploys: DeployRow[]
  isPending: boolean
  redeployPending: boolean
  onRedeploy: (deployId: number) => void
}

export function DeployHistory({
  deploys,
  isPending,
  redeployPending,
  onRedeploy,
}: DeployHistoryProps) {
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  return (
    <section className="space-y-3">
      <button
        type="button"
        className="inline-flex items-center gap-2 text-base font-semibold text-foreground cursor-pointer"
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
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <ul className="w-full divide-y divide-border">
            {!isPending && deploys.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">No deploys yet.</li>
            ) : null}
            {deploys.map((row) => {
              const expanded = expandedId === row.id
              return (
                <li key={row.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-sm cursor-pointer"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      <span className="font-mono">#{row.id}</span>{' '}
                      <span className="text-muted-foreground">{row.status}</span>
                      {expanded ? (
                        <CaretUp weight="regular" aria-hidden className="size-3.5" />
                      ) : (
                        <CaretDown weight="regular" aria-hidden className="size-3.5" />
                      )}
                    </button>
                    {row.status === 'succeeded' ? (
                      <button
                        type="button"
                        disabled={redeployPending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => onRedeploy(row.id)}
                      >
                        Redeploy
                      </button>
                    ) : null}
                  </div>
                  {expanded && row.log ? (
                    <pre
                      aria-label={`Deploy log #${row.id}`}
                      className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs"
                    >
                      {row.log}
                    </pre>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
