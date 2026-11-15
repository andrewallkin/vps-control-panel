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

function lastDeployLine(
  lastDeploy: NonNullable<ProjectSummary['last_deploy']>,
  nowMs: number,
) {
  return (
    <p className="text-sm text-muted-foreground">
      <time dateTime={lastDeploy.started_at} title={lastDeploy.started_at}>
        {formatIsoRelative(lastDeploy.started_at, nowMs)}
      </time>
      {' · '}
      <Badge tone={deployStatusTone(lastDeploy.status)} className="align-middle">
        {deployStatusLabel(lastDeploy.status)}
      </Badge>
    </p>
  )
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
    <Card className="group flex flex-col rounded-2xl p-6 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <Link
          to={href}
          className="min-w-0 text-xl font-semibold text-foreground underline-offset-2 hover:underline"
        >
          {project.display_name}
        </Link>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
        </div>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {project.slug} · {project.branch}
      </p>

      {project.primary_url ? (
        <a
          href={project.primary_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex max-w-full items-center gap-1 truncate text-sm font-medium text-accent hover:underline"
        >
          <ArrowSquareOut weight="regular" aria-hidden className="size-3.5 shrink-0" />
          {project.primary_url}
        </a>
      ) : null}

      {!ready && lastDeploy ? (
        <div className="mt-2">{lastDeployLine(lastDeploy, nowMs)}</div>
      ) : null}

      {ready ? (
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            {lastDeploy ? (
              lastDeployLine(lastDeploy, nowMs)
            ) : project.last_deploy === null ? (
              <p className="text-sm text-muted-foreground">No deploys yet</p>
            ) : null}
          </div>
          <Link
            to={`/projects/${encodeURIComponent(project.slug)}#deploy`}
            className={`${buttonClasses({ variant: 'secondary', size: 'sm' })} shrink-0 opacity-100 transition group-hover:opacity-100 sm:opacity-90`}
          >
            Deploy
          </Link>
        </div>
      ) : null}
    </Card>
  )
}