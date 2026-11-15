import { ArrowSquareOut } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../StatusBadge'
import { Badge, buttonClasses, Card } from '../ui'
import { deployStatusLabel, deployStatusTone } from '../../lib/deployStatus'
import { formatIsoRelative } from '../../lib/format'
import {
  projectCreationStatusLabel,
  type ProjectSummary,
} from '../../lib/projectsApi'
import {
  runtimeStatusLabel,
  runtimeStatusTone,
} from '../../lib/projectRuntime'

function creationStatusVariant(
  status: string,
): 'healthy' | 'warning' | 'critical' {
  if (status === 'ready') {
    return 'healthy'
  }
  if (status === 'failed') {
    return 'critical'
  }
  return 'warning'
}

function projectHref(project: ProjectSummary): string {
  const status = project.creation_state.status
  if (
    status === 'failed' ||
    status === 'awaiting_deploy_key' ||
    status === 'awaiting_ports' ||
    status === 'running'
  ) {
    return `/projects/new?slug=${encodeURIComponent(project.slug)}`
  }
  return `/projects/${encodeURIComponent(project.slug)}`
}

export function ProjectListRow({
  project,
  nowMs,
}: {
  project: ProjectSummary
  nowMs: number
}) {
  const creationStatus = project.creation_state.status
  const ready = creationStatus === 'ready'
  const href = projectHref(project)
  const lastDeploy = project.last_deploy

  return (
    <Card className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={href}
            className="text-base font-medium text-foreground underline-offset-2 hover:underline"
          >
            {project.display_name}
          </Link>
          <span className="font-mono text-sm text-muted-foreground">{project.slug}</span>
        </div>
        {project.primary_url ? (
          <a
            href={project.primary_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 truncate font-mono text-sm text-accent hover:underline"
          >
            <ArrowSquareOut weight="regular" aria-hidden className="size-3.5 shrink-0" />
            {project.primary_url}
          </a>
        ) : null}
        {lastDeploy ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Last deploy{' '}
              <time dateTime={lastDeploy.started_at} title={lastDeploy.started_at}>
                {formatIsoRelative(lastDeploy.started_at, nowMs)}
              </time>
            </span>
            <Badge tone={deployStatusTone(lastDeploy.status)}>
              {deployStatusLabel(lastDeploy.status)}
            </Badge>
          </div>
        ) : ready ? (
          <p className="text-sm text-muted-foreground">No deploys yet</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ready && project.runtime_status ? (
          <Badge tone={runtimeStatusTone(project.runtime_status)} dot>
            {runtimeStatusLabel(project.runtime_status)}
          </Badge>
        ) : null}
        {!ready ? (
          <StatusBadge
            variant={creationStatusVariant(creationStatus)}
            label={projectCreationStatusLabel(creationStatus)}
          />
        ) : null}
        {ready ? (
          <Link
            to={`/projects/${encodeURIComponent(project.slug)}#deploy`}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            Deploy
          </Link>
        ) : null}
      </div>
    </Card>
  )
}
