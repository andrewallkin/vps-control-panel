import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsListPage } from './ProjectsListPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const projectSummary = {
  slug: 'demo-app',
  display_name: 'Demo App',
  repo_url: 'https://github.com/example/demo',
  branch: 'main',
  compose_file: 'docker-compose.yml',
  deploy_mode: 'build' as const,
  docker_hub_repo: null,
  database_mode: 'none' as const,
  db_name: null,
  db_user: null,
  write_database_url: false,
  migration_command: null,
  migration_service: null,
  health_check_url: null,
  creation_state: { status: 'ready', steps: [] },
  created_at: '2026-01-01T00:00:00+00:00',
  runtime_status: 'running',
  primary_url: 'https://app.example.com/',
  last_deploy: {
    id: 9,
    status: 'succeeded',
    started_at: '2026-01-01T12:00:00+00:00',
    finished_at: '2026-01-01T12:01:00+00:00',
  },
}

describe('ProjectsListPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/projects') && !url.includes('/api/projects/')) {
          return Promise.resolve(jsonResponse([projectSummary]))
        }
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              username: 'admin',
              setup_complete: true,
              csrf_token: 'csrf',
              stepped_up_until: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('links awaiting_ports projects to the creation wizard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/projects') && !url.includes('/api/projects/')) {
          return Promise.resolve(
            jsonResponse([
              {
                ...projectSummary,
                slug: 'ports-wait',
                display_name: 'Ports Wait',
                creation_state: { status: 'awaiting_ports', steps: [] },
              },
            ]),
          )
        }
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              username: 'admin',
              setup_complete: true,
              csrf_token: 'csrf',
              stepped_up_until: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )

    renderWithProviders(<ProjectsListPage />)

    await waitFor(() => {
      expect(screen.getByText('Ports Wait')).toBeInTheDocument()
    })

    const link = screen.getByRole('link', { name: /Ports Wait/i })
    expect(link).toHaveAttribute('href', '/projects/new?slug=ports-wait')
  })

  it('does not show the empty state when loading projects fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/projects') && !url.includes('/api/projects/')) {
          return Promise.resolve(jsonResponse({ detail: 'server error' }, 500))
        }
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              username: 'admin',
              setup_complete: true,
              csrf_token: 'csrf',
              stepped_up_until: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )

    renderWithProviders(<ProjectsListPage />)

    await waitFor(() => {
      expect(screen.getByText('Could not load projects.')).toBeInTheDocument()
    })

    expect(screen.queryByText('There are no projects yet.')).not.toBeInTheDocument()
  })

  it('loads the latest deploy when the project list omits last_deploy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/api/projects')) {
          const withoutLastDeploy = JSON.parse(
            JSON.stringify(projectSummary, (key, value) =>
              key === 'last_deploy' ? undefined : value,
            ),
          ) as Omit<typeof projectSummary, 'last_deploy'>
          return Promise.resolve(jsonResponse([withoutLastDeploy]))
        }
        if (url.includes('/api/projects/demo-app/deploys')) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 34,
                status: 'succeeded',
                trigger: 'deploy',
                tags: {},
                commit: 'abc',
                started_at: '2026-11-13T15:20:44+00:00',
                finished_at: '2026-11-13T15:21:34+00:00',
                log: '',
                job_id: null,
              },
            ]),
          )
        }
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              username: 'admin',
              setup_complete: true,
              csrf_token: 'csrf',
              stepped_up_until: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )

    renderWithProviders(<ProjectsListPage />)

    await waitFor(() => {
      expect(screen.getByText('Succeeded')).toBeInTheDocument()
    })
    expect(screen.queryByText('No deploys yet')).not.toBeInTheDocument()
  })

  it('shows runtime, deploy summary, and a separate public URL link', async () => {
    renderWithProviders(<ProjectsListPage />)

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument()
    })

    const publicLink = screen.getByRole('link', { name: /https:\/\/app\.example\.com\//i })
    expect(publicLink).toHaveAttribute('target', '_blank')

    const nameLink = screen.getByRole('link', { name: 'Demo App' })
    expect(nameLink).not.toBe(publicLink)
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
  })

  it('lists projects and uses full-width page layout', async () => {
    renderWithProviders(<ProjectsListPage />)

    await waitFor(() => {
      expect(screen.getByText('Demo App')).toBeInTheDocument()
    })

    const page =
      screen.getByRole('heading', { name: 'Projects' }).parentElement?.parentElement
        ?.parentElement
    expect(page).toHaveClass('w-full')
    expect(page).not.toHaveClass('max-w-6xl')
  })
})
