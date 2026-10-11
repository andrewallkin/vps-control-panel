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
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
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
        <p className="text-sm text-destructive">Could not load projects.</p>
      ) : null}

      {!projectsQuery.isPending && projects.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">There are no projects yet.</p>
          <Link to="/projects/new" className="mt-3 inline-block text-sm font-medium text-accent">
            Create your first project
          </Link>
        </div>
      ) : null}

      {projects.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
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
                  className="flex flex-col gap-2 px-4 py-4 transition-colors duration-200 hover:bg-muted sm:flex-row sm:items-center sm:justify-between cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{project.display_name}</p>
                    <p className="font-mono text-sm text-muted-foreground">{project.slug}</p>
                  </div>
                  <StatusBadge
                    variant={statusVariant(status)}
                    label={projectCreationStatusLabel(status)}
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
