import { useState } from 'react'
import type { JobEndPayload } from '../../lib/setupApi'
import { Alert, Badge, Button, Card, CardBody } from '../ui'

export interface RestoreResultSummaryProps {
  end: JobEndPayload
  onContinue?: () => void
  onRetry?: () => void
}

function statusTone(status: string): 'success' | 'danger' | 'warning' {
  if (status === 'succeeded') {
    return 'success'
  }
  if (status === 'failed') {
    return 'danger'
  }
  return 'warning'
}

export function RestoreResultSummary({ end, onContinue, onRetry }: RestoreResultSummaryProps) {
  const [errorsOpen, setErrorsOpen] = useState(false)
  const result = end.result
  const databases = result?.databases ?? []
  const roles = result?.roles ?? []
  const errorCount = result?.error_count
  const errors = result?.errors ?? []
  const safetyDump =
    typeof result?.safety_dump === 'string' && result.safety_dump.length > 0
      ? result.safety_dump
      : null

  const dbNames = databases.map((entry) =>
    typeof entry === 'string'
      ? entry
      : typeof entry === 'object' && entry !== null && 'name' in entry
        ? String((entry as { name: string }).name)
        : JSON.stringify(entry),
  )

  const statusLabel = `Restore ${end.status}`

  return (
    <Card className="bg-muted/40">
      <CardBody className="space-y-2">
        <div role="status" className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-semibold">Restore result</h3>
            <Badge tone={statusTone(end.status)} dot>
              {statusLabel}
            </Badge>
          </div>
          {end.error ? (
            <Alert tone="danger">{end.error}</Alert>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {dbNames.length} database{dbNames.length === 1 ? '' : 's'},{' '}
            {roles.length} role{roles.length === 1 ? '' : 's'}
            {typeof errorCount === 'number'
              ? `, ${errorCount} error${errorCount === 1 ? '' : 's'} in log`
              : null}
            .
          </p>
          {dbNames.length > 0 ? (
            <p className="text-sm">
              <span className="font-medium">Databases:</span> {dbNames.join(', ')}
            </p>
          ) : null}
          {roles.length > 0 ? (
            <p className="text-sm">
              <span className="font-medium">Roles:</span> {roles.join(', ')}
            </p>
          ) : null}
          {errors.length > 0 ? (
            <div>
              <button
                type="button"
                className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
                aria-expanded={errorsOpen}
                onClick={() => setErrorsOpen((open) => !open)}
              >
                {errorsOpen ? 'Hide error lines' : 'Show error lines'}
              </button>
              {errorsOpen ? (
                <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 font-mono text-xs">
                  {errors.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {end.status === 'succeeded' && onContinue ? (
            <Button type="button" onClick={onContinue}>
              Continue
            </Button>
          ) : null}
          {end.status === 'failed' && safetyDump ? (
            <p className="text-sm text-muted-foreground">
              The previous cluster was saved on this server before the load started. Copy that file
              off the server and upload it here if you need the previous data back.
              <span className="mt-1 block break-all font-mono text-xs text-foreground">{safetyDump}</span>
            </p>
          ) : null}
          {end.status === 'failed' && onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  )
}