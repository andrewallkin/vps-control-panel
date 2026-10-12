export interface MigrationRunControlsProps {
  configured: boolean
  command: string | null
  runMigrations: boolean
  onToggle: (run: boolean) => void
  onRunNow: () => void
  hasDatabase?: boolean
  runNowDisabled?: boolean
}

export function MigrationRunControls({
  configured,
  command,
  runMigrations,
  onToggle,
  onRunNow,
  hasDatabase = false,
  runNowDisabled = false,
}: MigrationRunControlsProps) {
  if (!configured) {
    if (!hasDatabase) {
      return null
    }
    return (
      <div className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
        <p className="font-medium text-warning">
          Migrations are not configured for this project.
        </p>
        <p className="mt-1 text-muted-foreground">
          Set the migration service and command in Settings (for example{' '}
          <span className="font-mono">backend</span> +{' '}
          <span className="font-mono">bash /app/run_migrations.sh</span>) so
          deploys can run your Alembic migrations.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={runMigrations}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Run database migrations
      </label>
      {command ? (
        <p className="text-xs text-muted-foreground">
          Command: <span className="font-mono">{command}</span>
        </p>
      ) : null}
      <button
        type="button"
        disabled={runNowDisabled}
        className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
        onClick={onRunNow}
      >
        Run migrations
      </button>
    </div>
  )
}
