import { Plus } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ProjectListRow } from '../components/projects/ProjectListRow'
import { buttonClasses, Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import { fetchProjects } from '../lib/projectsApi'

export function ProjectsListPage() {
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    refetchIntervalInBackground: false,
  })

  const projects = projectsQuery.data ?? []
  const [nowMs] = useState(() => Date.now())

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
        <ul className="grid w-full gap-3 sm:grid-cols-1 lg:grid-cols-2">
          {projects.map((project) => (
            <li key={project.slug}>
              <ProjectListRow project={project} nowMs={nowMs} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
