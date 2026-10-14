import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { ProjectPage } from './ProjectPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const project = {
  slug: 'demo',
  display_name: 'Demo',
  repo_url: 'git@example.com:demo.git',
  branch: 'main',
  compose_file: 'compose.yml',
  deploy_mode: 'image',
  docker_hub_repo: null,
  database_mode: 'new',
  db_name: 'demo',
  db_user: 'demo_user',
  write_database_url: true,
  migration_command: null,
  migration_service: null,
  health_check_url: null,
  creation_state: { status: 'ready', steps: [] },
  created_at: '2026-01-01T00:00:00Z',
  hostnames: [],
  routes: [],
  services: [],
}

describe('ProjectPage database rotate', () => {
  let rotateStatus = 403

  beforeEach(() => {
    window.location.hash = ''
    rotateStatus = 403
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/api/projects/demo')) {
          return Promise.resolve(jsonResponse(project))
        }
        if (url.includes('/compose/ps')) {
          return Promise.resolve(jsonResponse({ services: [] }))
        }
        if (url.includes('/api/metrics/containers')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/dumps')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/env') && init?.method === 'PATCH') {
          return Promise.resolve(jsonResponse({}))
        }
        if (url.includes('/env')) {
          return Promise.resolve(jsonResponse({ entries: [] }))
        }
        if (url.includes('/tags')) {
          return Promise.resolve(jsonResponse({ services: [] }))
        }
        if (url.endsWith('/deploy') && init?.method === 'POST') {
          return Promise.resolve(jsonResponse({ id: 7, status: 'running' }))
        }
        if (url.includes('/deploys')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/api/database/rotate')) {
          if (rotateStatus === 403) {
            return Promise.resolve(jsonResponse({ detail: 'step_up_required' }, 403))
          }
          if (rotateStatus >= 400) {
            return Promise.resolve(jsonResponse({ detail: 'agent unavailable' }, rotateStatus))
          }
          return Promise.resolve(jsonResponse({ restart_required: true }))
        }
        if (url.includes('/api/auth/step-up') && init?.method === 'POST') {
          rotateStatus = 200
          return Promise.resolve(jsonResponse({ stepped_up_until: '2099-01-01T00:00:00Z' }))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function clickRotate() {
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Database' }))
    await userEvent.click(screen.getByRole('button', { name: 'Rotate password' }))
  }

  it('asks for an authenticator code when rotate requires step-up', async () => {
    await clickRotate()

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm with authenticator' })
    expect(screen.queryByRole('alertdialog', { name: 'Rotate database password' })).not.toBeInTheDocument()
    expect(screen.queryByText(/password rotated/i)).not.toBeInTheDocument()

    await userEvent.type(within(stepUp).getByLabelText('Authenticator code'), '123456')
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Verify' }))

    const deploy = await screen.findByRole('alertdialog', {
      name: 'Deploy to apply the new password',
    })
    expect(deploy).toHaveTextContent('The database password is already changed.')

    await userEvent.click(within(deploy).getByRole('button', { name: 'Deploy' }))
    await screen.findByRole('tab', { name: 'Deploy', selected: true })
  })

  it('asks to deploy after an environment save', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Environment' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add variable' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByRole('alertdialog', { name: 'Deploy to apply environment changes' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/restart services/i)).not.toBeInTheDocument()
  })

  it('shows an error when rotate fails', async () => {
    rotateStatus = 502
    await clickRotate()

    expect(await screen.findByRole('alert')).toHaveTextContent('agent unavailable')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Confirm with authenticator' })).not.toBeInTheDocument()
    })
  })
})
