import type { DashboardWarning } from '../../lib/dashboardTypes'
import { StatusBadge } from '../StatusBadge'
import { Card, CardBody } from '../ui'

export interface WarningsListProps {
  warnings: DashboardWarning[]
}

export function WarningsList({ warnings }: WarningsListProps) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <section aria-label="Warnings">
          <h2 className="text-sm font-semibold">Warnings</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {warnings.map((warning) => (
              <li key={`${warning.code}-${warning.message}`} className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  variant={warning.level === 'critical' ? 'critical' : 'warning'}
                  label={warning.message}
                />
                <span className="font-mono text-xs text-muted-foreground">{warning.code}</span>
              </li>
            ))}
          </ul>
        </section>
      </CardBody>
    </Card>
  )
}