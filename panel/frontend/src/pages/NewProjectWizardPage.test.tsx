import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewProjectWizardPage } from './NewProjectWizardPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const domains = [
  {
    name: 'example.com',
    zone_id: 'zone-1',
    cert_status: 'active',
    cert_expires_at: null,
    ssl_mode: null,
    ssl_mode_error: null,
    warning: null,
    hostnames: [],
  },
]

const readyProject = (deployMode: 'image' | 'build') => ({
  slug: 'test-app',
  display_name: 'Test App',
  deploy_mode: deployMode,
  creation_state: { status: 'ready', steps: [], public_key: null },
  hostnames: [],
  routes: [],
  services: [],
})

const deployCalls: { url: string; body: Record<string, unknown> }[] = []

let projectMode: 'image' | 'build' = 'build'

describe('NewProjectWizardPage database step', () => {
  beforeEach(() => {
    deployCalls.length = 0
    projectMode = 'build'
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        if (url.includes('/api/domains')) {
          return Promise.resolve(jsonResponse(domains))
        }
        if (url.endsWith('/api/projects') && method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              slug: 'test-app',
              creation_state: { status: 'ready', steps: [], public_key: null },
            }),
          )
        }
        if (url.endsWith('/api/projects') && method === 'GET') {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/api/projects/test-app/deploy') && method === 'POST') {
          deployCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
          return Promise.resolve(jsonResponse({ id: 1, status: 'running' }))
        }
        if (url.includes('/api/projects/test-app/tags')) {
          return Promise.resolve(
            jsonResponse({
              services: [
                { service: 'web', image_env_var: 'WEB_IMAGE', tags: ['latest', 'v1'] },
              ],
            }),
          )
        }
        if (url.includes('/api/projects/test-app')) {
          return Promise.resolve(jsonResponse(readyProject(projectMode)))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function goToDatabaseStep() {
    const user = userEvent.setup()
    renderWithProviders(<NewProjectWizardPage />, {
      routerProps: { initialEntries: ['/projects/new'] },
    })

    await screen.findByRole('link', { name: '← Projects' })

    await user.type(screen.getByLabelText('Display name'), 'Test App')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByLabelText('Build from repository'))
    await user.type(screen.getByLabelText('Repository URL'), 'git@github.com:owner/name.git')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.selectOptions(screen.getByLabelText('Primary domain'), 'example.com')
    await user.type(screen.getByLabelText('Port env var'), 'WEB_PORT')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByLabelText('Create new'))
  }

  it('explains the deploy key is generated at the end of setup when no key exists yet', async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewProjectWizardPage />, {
      routerProps: { initialEntries: ['/projects/new'] },
    })

    await screen.findByRole('link', { name: '← Projects' })

    await user.type(screen.getByLabelText('Display name'), 'Test App')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Repository URL'), 'git@github.com:owner/name.git')

    expect(await screen.findByText(/generated at the end of setup/i)).toBeInTheDocument()
    expect(screen.queryByText(/Creation waits until you add it/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Add this read-only deploy key/i)).not.toBeInTheDocument()
  })

  it('starts with the DATABASE_URL checkbox unticked when creating a new database', async () => {
    await goToDatabaseStep()

    const checkbox = await screen.findByRole('checkbox', {
      name: /Write DATABASE_URL to \.env/,
    })
    expect(checkbox).not.toBeChecked()
  })

  it('explains DATABASE_URL vs the individual POSTGRES variables on hover', async () => {
    await goToDatabaseStep()

    await screen.findByRole('checkbox', { name: /Write DATABASE_URL to \.env/ })
    const info = screen.getByTitle(/DATABASE_URL/)
    expect(info).toHaveAttribute('title', expect.stringContaining('POSTGRES_'))
    expect(info).toHaveAttribute('aria-label', expect.stringMatching(/database variables/i))
  })

  async function createBuildProject() {
    const user = userEvent.setup()
    await goToDatabaseStep()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByRole('button', { name: 'Create project' }))
    await screen.findByRole('button', { name: 'Deploy now' })
  }

  it('starts a build deploy and lands on the deploy tab when Deploy now is clicked', async () => {
    await createBuildProject()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Deploy now' }))

    await vi.waitFor(() => {
      expect(deployCalls).toEqual([
        { url: '/api/projects/test-app/deploy', body: { build: true, run_migrations: true } },
      ])
    })
  })

  it('starts an image deploy with the default tag when the project is image mode', async () => {
    projectMode = 'image'

    await createBuildProject()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Deploy now' }))

    await vi.waitFor(() => {
      expect(deployCalls).toEqual([
        {
          url: '/api/projects/test-app/deploy',
          body: { tags: { WEB_IMAGE: 'latest' }, run_migrations: true },
        },
      ])
    })
  })
})
