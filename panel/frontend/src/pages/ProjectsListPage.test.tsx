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
