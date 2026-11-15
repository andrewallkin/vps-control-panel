import type { DashboardWarning } from '../../lib/dashboardTypes'
import { Alert } from '../ui'

export interface WarningsListProps {
  warnings: DashboardWarning[]
}

export function WarningsList({ warnings }: WarningsListProps) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <section aria-label="Warnings" className="flex flex-col gap-2">
      {warnings.map((warning) => (
        <Alert
          key={`${warning.code}-${warning.message}`}
          tone={warning.level === 'critical' ? 'danger' : 'warning'}
          title={warning.message}
        >
          <span className="font-mono text-sm">{warning.code}</span>
        </Alert>
      ))}
    </section>
  )
}
