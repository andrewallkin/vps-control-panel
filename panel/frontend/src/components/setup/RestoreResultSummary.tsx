import { CheckCircle, Warning, XCircle } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import type { JobEndPayload } from '../../lib/setupApi'

function restoreStatusDisplay(status: string): {
  className: string
  icon: ReactNode
  label: string
} {
  const label = `Restore ${status}`
  if (status === 'succeeded') {
    return {
      className: 'text-accent',
      icon: <CheckCircle weight="regular" aria-hidden className="size-4" />,
      label,
    }
  }
  if (status === 'failed') {
    return {
      className: 'text-destructive',
      icon: <XCircle weight="regular" aria-hidden className="size-4" />,
      label,
    }
  }
  return {
    className: 'text-warning',
    icon: <Warning weight="regular" aria-hidden className="size-4" />,
    label,
  }
}

export interface RestoreResultSummaryProps {
  end: JobEndPayload
  onContinue?: () => void
  onRetry?: () => void
}

export function RestoreResultSummary({ end, onContinue, onRetry }: RestoreResultSummaryProps) {
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

  const statusUi = restoreStatusDisplay(end.status)

  return (
    <div role="status" className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">Restore result</h3>
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-medium ${statusUi.className}`}
        >
          {statusUi.icon}
          {statusUi.label}
        </span>
      </div>
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
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline cursor-pointer"
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
      {end.status === 'succeeded' && onContinue ? (
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onContinue}
        >
          Continue
        </button>
      ) : null}
      {end.status === 'failed' && onRetry ? (
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onRetry}
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}
