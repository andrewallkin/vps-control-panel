import { Plus } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { buttonClasses, Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import { fetchProjects, projectCreationStatusLabel } from '../lib/projectsApi'

function statusVariant(
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

export function ProjectsListPage() {
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    refetchIntervalInBackground: false,
  })

  const projects = projectsQuery.data ?? []

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        className="w-full"
        title="Projects"
        description="Deploy and manage application stacks on this server."
        actions={
          <Link to="/projects/new" className={buttonClasses()}>
            <Plus weight="regular" aria-hidden className="size-4" />
            New project
          </Link>
        }
      />

      {projectsQuery.isPending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading projects…
        </p>
      ) : null}

      {projectsQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">Could not load projects.</p>
      ) : null}

      {!projectsQuery.isPending && !projectsQuery.isError && projects.length === 0 ? (
        <Card>
          <EmptyState
            title="There are no projects yet."
            action={
              <Link
                to="/projects/new"
                className="text-sm font-medium underline-offset-2 hover:underline cursor-pointer text-accent"
              >
                Create your first project
              </Link>
            }
          />
        </Card>
      ) : null}

      {projects.length > 0 ? (
        <Card className="divide-y divide-border overflow-hidden p-0">
          <ul className="w-full">
            {projects.map((project) => {
              const status = project.creation_state.status
              const href =
                status === 'failed' ||
                status === 'awaiting_deploy_key' ||
                status === 'awaiting_ports' ||
                status === 'running'
                  ? `/projects/new?slug=${encodeURIComponent(project.slug)}`
                  : `/projects/${encodeURIComponent(project.slug)}`
              return (
                <li key={project.slug}>
                  <Link
                    to={href}
                    className="flex cursor-pointer flex-col gap-2 px-4 py-4 transition-colors duration-200 hover:bg-muted sm:flex-row sm:items-center sm:justify-between lg:gap-4 lg:px-6"
                  >
                    <div className="min-w-0 flex-1 lg:grid lg:grid-cols-[12rem_1fr] lg:items-baseline lg:gap-4">
                      <p className="font-medium text-foreground">{project.display_name}</p>
                      <p className="font-mono text-sm text-muted-foreground">{project.slug}</p>
                    </div>
                    <div className="shrink-0">
                      <StatusBadge
                        variant={statusVariant(status)}
                        label={projectCreationStatusLabel(status)}
                      />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}