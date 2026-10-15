import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import {
  confirmCreationPorts,
  fetchUsedPorts,
  type CreationState,
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

export interface PortsConfirmSectionProps {
  slug: string
  portChoices: Record<string, number | null>
  onConfirmed?: (state: CreationState) => void
}

export function PortsConfirmSection({
  slug,
  portChoices,
  onConfirmed,
}: PortsConfirmSectionProps) {
  const usedPortsQuery = useQuery({
    queryKey: ['ports', 'used'],
    queryFn: fetchUsedPorts,
  })
  const usedPorts = usedPortsQuery.data ?? []

  const [rows, setRows] = useState<PortDraft[]>(() =>
    Object.entries(portChoices).map(([env_var, defaultValue]) => ({
      env_var,
      default: defaultValue,
      host_port: defaultValue === null ? '' : String(defaultValue),
    })),
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const validation = validatePortDrafts(rows, usedPorts, slug)

  async function handleSubmit() {
    setSubmitError(null)
    if (!validation.ok) {
      setSubmitError(validation.error)
      return
    }
    const ports: Record<string, number> = {}
    for (const row of rows) {
      const port = parsePortDraft(row.host_port)
      if (port === null) {
        setSubmitError(`${row.env_var}: enter a port between 1 and 65535`)
        return
      }
      ports[row.env_var] = port
    }
    setSubmitting(true)
    try {
      const result = await confirmCreationPorts(slug, ports)
      onConfirmed?.(result.creation_state)
    } catch (error) {
      setSubmitError(errorText(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        The compose file publishes ports. Choose the host port for each one; routing will use the
        ports you set here.
      </p>
      <PortsMappingEditor
        rows={rows}
        usedPorts={usedPorts}
        selfSlug={slug}
        onChange={setRows}
      />
      {submitError ? (
        <p className="text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
      <button
        type="button"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={handleSubmit}
      >
        {submitting ? 'Saving…' : 'Continue'}
      </button>
    </div>
  )
}
