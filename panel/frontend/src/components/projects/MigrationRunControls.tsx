import { Alert, Button, Card, CardBody, Checkbox } from '../ui'

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
      <Alert tone="warning" title="Migrations are not configured for this project.">
        <>
          Set the migration service and command in Settings (for example{' '}
          <span className="font-mono">backend</span> +{' '}
          <span className="font-mono">bash /app/run_migrations.sh</span>) so deploys can run your
          Alembic migrations.
        </>
      </Alert>
    )
  }

  return (
    <Card>
      <CardBody className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={runMigrations}
            onChange={(event) => onToggle(event.target.checked)}
          />
          Run database migrations
        </label>
        {command ? (
          <p className="text-sm text-muted-foreground">
            Command: <span className="font-mono">{command}</span>
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={runNowDisabled}
          onClick={onRunNow}
        >
          Run migrations
        </Button>
      </CardBody>
    </Card>
  )
}