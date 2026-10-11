import { useState } from 'react'
import type { JobEndPayload } from '../../lib/setupApi'

export interface RestoreResultSummaryProps {
  end: JobEndPayload
}

export function RestoreResultSummary({ end }: RestoreResultSummaryProps) {
  const [errorsOpen, setErrorsOpen] = useState(false)
  const result = end.result
  const databases = result?.databases ?? []
  const roles = result?.roles ?? []
  const errorCount = result?.error_count
  const errors = result?.errors ?? []

  const dbNames = databases.map((entry) =>
    typeof entry === 'string'
      ? entry
      : typeof entry === 'object' && entry !== null && 'name' in entry
        ? String((entry as { name: string }).name)
        : JSON.stringify(entry),
  )

  return (
    <div role="status" className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
      <h3 className="text-sm font-semibold">Restore {end.status}</h3>
      {end.error ? (
        <p className="text-sm text-destructive">{end.error}</p>
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
            className="text-sm font-medium text-foreground underline-offset-2 hover:underline cursor-pointer"
            aria-expanded={errorsOpen}
            onClick={() => setErrorsOpen((open) => !open)}
          >
            {errorsOpen ? 'Hide error lines' : 'Show error lines'}
          </button>
          {errorsOpen ? (
            <ul className="mt-2 max-h-40 overflow-auto font-mono text-xs list-disc pl-5">
              {errors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
