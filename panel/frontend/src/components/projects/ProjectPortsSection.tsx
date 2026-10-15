import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import {
  fetchProjectPorts,
  fetchUsedPorts,
  putProjectPorts,
} from '../../lib/projectsApi'
import {
  parsePortDraft,
  validatePortDrafts,
  type PortDraft,
} from '../../lib/portMappings'
import { PortsMappingEditor } from './PortsMappingEditor'

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: string } | null
    if (body && typeof body.detail === 'string') {
      return body.detail
    }
  }
  return error instanceof Error ? error.message : 'Could not save ports.'
}

export interface ProjectPortsSectionProps {
  slug: string
}

export function ProjectPortsSection({ slug }: ProjectPortsSectionProps) {
  const queryClient = useQueryClient()
  const portsQuery = useQuery({
    queryKey: ['projects', slug, 'ports'],
    queryFn: () => fetchProjectPorts(slug),
  })
  const usedPortsQuery = useQuery({
    queryKey: ['ports', 'used'],
    queryFn: fetchUsedPorts,
  })
  const usedPorts = usedPortsQuery.data ?? []

  const [rows, setRows] = useState<PortDraft[]>([])
  const [appliedData, setAppliedData] = useState(portsQuery.data)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  if (portsQuery.data !== undefined && portsQuery.data !== appliedData) {
    setAppliedData(portsQuery.data)
    if (!dirty) {
      setRows(
        portsQuery.data.ports.map((row) => ({
          env_var: row.env_var,
          default: row.default,
          service: row.service,
          host_port: row.host_port === null ? '' : String(row.host_port),
        })),
      )
    }
  }

  const validation = validatePortDrafts(rows, usedPorts, slug)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ports: Record<string, number> = {}
      for (const row of rows) {
        const port = parsePortDraft(row.host_port)
        if (port === null) {
          throw new Error(`${row.env_var}: enter a port between 1 and 65535`)
        }
        ports[row.env_var] = port
      }
      return putProjectPorts(slug, ports)
    },
    onSuccess: (result) => {
      setError(null)
      setSavedMessage('Saved. Redeploy the project to apply the new ports.')
      setDirty(false)
      queryClient.setQueryData(['projects', slug, 'ports'], result)
      queryClient.invalidateQueries({ queryKey: ['ports', 'used'] })
    },
    onError: (saveError) => {
      setError(errorText(saveError))
    },
  })

  return (
    <div className="space-y-4">
      {portsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading port mappings…</p>
      ) : portsQuery.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive" role="alert">
            {errorText(portsQuery.error)}
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer"
            onClick={() => portsQuery.refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <PortsMappingEditor
            rows={rows}
            usedPorts={usedPorts}
            selfSlug={slug}
            onChange={(next) => {
              setRows(next)
              setDirty(true)
            }}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {!validation.ok ? (
            <p className="text-sm text-destructive" role="alert">
              {validation.error}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!dirty || saveMutation.isPending || !validation.ok}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            {savedMessage ? (
              <p className="text-sm text-muted-foreground" role="status">
                {savedMessage}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
