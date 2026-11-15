import type { UploadCompleteInfo } from '../../lib/setupApi'
import { formatBytes } from '../../lib/format'
import { Badge, Card, CardBody } from '../ui'

export interface UploadInfoPanelProps {
  info: UploadCompleteInfo
}

export function UploadInfoPanel({ info }: UploadInfoPanelProps) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Dump summary</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {info.filename} · {formatBytes(info.size)} · {info.kind}
            </p>
          </div>
          <Badge tone={info.header_ok ? 'success' : 'warning'}>
            {info.header_ok ? 'Header OK' : 'Header not recognized'}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Databases found
            </h4>
            {info.databases.length === 0 ? (
              <p className="mt-1 text-sm">None detected.</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-sm">
                {info.databases.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Roles found
            </h4>
            {info.roles.length === 0 ? (
              <p className="mt-1 text-sm">None detected.</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-sm">
                {info.roles.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}