import { Plus, Spinner } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Deploy and manage application stacks on this server.
          </p>
        </div>
        <Link
          to="/projects/new"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer"
        >
          <Plus weight="regular" aria-hidden className="size-4" />
          New project
        </Link>
      </div>

      {projectsQuery.isPending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          Loading projects…
        </p>
      ) : null}

      {projectsQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">Could not load projects.</p>
      ) : null}

      {!projectsQuery.isPending && projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">There are no projects yet.</p>
          <Link
            to="/projects/new"
            className="mt-3 inline-block text-sm font-medium underline-offset-2 hover:underline cursor-pointer text-accent"
          >
            Create your first project
          </Link>
        </div>
      ) : null}

      {projects.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {projects.map((project) => {
            const status = project.creation_state.status
            const href =
              status === 'failed'
                ? `/projects/new?slug=${encodeURIComponent(project.slug)}`
                : `/projects/${encodeURIComponent(project.slug)}`
            return (
              <li key={project.slug}>
                <Link
                  to={href}
                  className="flex cursor-pointer flex-col gap-2 px-4 py-4 transition-colors duration-200 hover:bg-muted sm:flex-row sm:items-center sm:justify-between lg:gap-4 lg:px-6"
                >
                  <div className="min-w-0 flex-1 lg:flex lg:items-baseline lg:gap-6 xl:gap-10">
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
      ) : null}
    </div>
  )
}
