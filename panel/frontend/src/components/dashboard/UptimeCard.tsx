import { useQueryStale } from '../../hooks/useQueryStale'
import { useTickingNow } from '../../hooks/useTickingNow'
import { formatSecondsAgo, formatUptime } from '../../lib/format'
import { StaleBadge } from '../StatusBadge'
import { Card, CardBody } from '../ui'

export interface UptimeCardProps {
  uptimeSeconds: number | undefined
  dataUpdatedAt: number
}

export function UptimeCard({ uptimeSeconds, dataUpdatedAt }: UptimeCardProps) {
  const now = useTickingNow()
  const isStale = useQueryStale(dataUpdatedAt)

  return (
    <Card className="shrink-0">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-xl font-semibold text-foreground">Uptime</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>updated {formatSecondsAgo(dataUpdatedAt, now)}</span>
            {isStale ? <StaleBadge /> : null}
          </div>
        </div>
        <p className="text-[40px] font-semibold leading-none tabular-nums">
          {uptimeSeconds !== undefined ? formatUptime(uptimeSeconds) : '—'}
        </p>
      </CardBody>
    </Card>
  )
}