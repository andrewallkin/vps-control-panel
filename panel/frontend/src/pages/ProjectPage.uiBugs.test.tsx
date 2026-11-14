import { screen, waitFor } from '@testing-library/react'
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

async function editEnvValue(user: ReturnType<typeof userEvent.setup>, key: string, value: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${key}$`) }))
  const textarea = await screen.findByRole('textbox', { name: 'Full value' })
  await user.clear(textarea)
  await user.type(textarea, value)
  await user.click(screen.getByRole('button', { name: 'Done' }))
}

const baseProject = {
  slug: 'demo',
  display_name: 'Demo',
  repo_url: 'git@example.com:demo.git',
  branch: 'main',
  compose_file: 'compose.yml',
  deploy_mode: 'build' as const,
  docker_hub_repo: null,
  database_mode: 'none' as const,
  db_name: null,
  db_user: null,
  write_database_url: false,
  migration_command: 'bash /app/migrate.sh',
  migration_service: 'backend',
  health_check_url: null,
  creation_state: { status: 'ready' as const, steps: [] },
  created_at: '2026-01-01T00:00:00Z',
  hostnames: [],
  routes: [
    {
      path_prefix: '/',
      port_env_var: 'WEB_PORT',
      websocket: true,
      streaming: false,
      pass_authorization: false,
      max_body_mb: 10,
      read_timeout_s: 30,
      send_timeout_s: 45,
    },
  ],
  services: [],
}

describe('ProjectPage routing draft and save', () => {
  let routingPutBody: unknown

  beforeEach(() => {
    routingPutBody = null
    window.location.hash = ''
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/projects/demo') && method === 'GET') {
          return Promise.resolve(jsonResponse(baseProject))
        }
        if (url.includes('/routing') && method === 'PUT') {
          routingPutBody = JSON.parse(init?.body as string)
          return Promise.resolve(jsonResponse({}))
        }
        if (url.includes('/domains')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.endsWith('/api/projects/demo/ports')) {
          return Promise.resolve(jsonResponse({ ports: [] }))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openRoutingTab() {
    window.location.hash = '#routing'
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo#routing'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await screen.findByRole('tab', { name: 'Routing', selected: true })
  }

  it('loads saved route options into the routing editor', async () => {
    await openRoutingTab()
    const websocket = await screen.findByRole('checkbox', { name: 'WebSocket' })
    expect(websocket).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Streaming' })).not.toBeChecked()
  })

  it('sends streaming from the draft when toggled and saved', async () => {
    const user = userEvent.setup()
    await openRoutingTab()
    await user.click(screen.getByRole('checkbox', { name: 'WebSocket' }))
    const streaming = await screen.findByRole('checkbox', { name: 'Streaming' })
    expect(streaming).not.toBeChecked()
    await user.click(streaming)
    expect(streaming).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save routing' }))
    await waitFor(() => expect(routingPutBody).not.toBeNull())
    const routes = (routingPutBody as { routes: { streaming: boolean }[] }).routes
    expect(routes[0]?.streaming).toBe(true)
  })

  it('disables save routing when routes are invalid', async () => {
    const user = userEvent.setup()
    await openRoutingTab()
    const portField = await screen.findByLabelText('Port env var')
    await user.clear(portField)
    await user.type(portField, 'bad')
    expect(screen.getByRole('button', { name: 'Save routing' })).toBeDisabled()
  })
})

describe('ProjectPage mutation errors', () => {
  beforeEach(() => {
    window.location.hash = ''
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/projects/demo') && method === 'GET') {
          return Promise.resolve(jsonResponse(baseProject))
        }
        if (url.endsWith('/deploy') && method === 'POST') {
          return Promise.resolve(jsonResponse({ detail: 'deploy already running' }, 409))
        }
        if (url.endsWith('/api/projects/demo') && method === 'PATCH') {
          return Promise.resolve(jsonResponse({ detail: 'invalid migration service' }, 400))
        }
        if (url.includes('/env') && method === 'PATCH') {
          return Promise.resolve(jsonResponse({ detail: 'conflict' }, 409))
        }
        if (url.includes('/env') && method === 'GET') {
          return Promise.resolve(jsonResponse({ entries: [{ key: 'FOO', value: 'bar', masked: false }] }))
        }
        if (url.includes('/deploys')) {
          return Promise.resolve(jsonResponse([]))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows deploy errors from the API', async () => {
    window.location.hash = '#deploy'
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo#deploy'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await screen.findByRole('tab', { name: 'Deploy', selected: true })
    await user.click(screen.getByRole('button', { name: 'Build & deploy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('deploy already running')
  })

  it('shows settings save errors', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid migration service')
  })

  it('shows environment save errors', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Environment' }))
    await screen.findByRole('button', { name: 'FOO' })
    await editEnvValue(user, 'FOO', 'value')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('conflict')
  })
})

describe('ProjectPage environment dirty routing refetch', () => {
  let projectFetchCount = 0
  let projectRoutes: typeof baseProject.routes

  beforeEach(() => {
    projectFetchCount = 0
    projectRoutes = [...baseProject.routes]
    window.location.hash = ''
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/projects/demo') && method === 'GET') {
          projectFetchCount += 1
          return Promise.resolve(
            jsonResponse({ ...baseProject, routes: projectRoutes }),
          )
        }
        if (url.includes('/routing') && method === 'PUT') {
          projectRoutes = [
            {
              ...baseProject.routes[0]!,
              port_env_var: 'API_PORT',
              websocket: false,
              streaming: false,
            },
          ]
          return Promise.resolve(jsonResponse({}))
        }
        if (url.includes('/env') && method === 'GET') {
          return Promise.resolve(jsonResponse({ entries: [{ key: 'FOO', value: 'old', masked: false }] }))
        }
        if (url.includes('/domains')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.endsWith('/api/projects/demo/ports')) {
          return Promise.resolve(jsonResponse({ ports: [] }))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps unsaved env edits when route port vars change after routing save', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Environment' }))
    await screen.findByRole('button', { name: 'FOO' })
    await editEnvValue(user, 'FOO', 'edited')

    await user.click(screen.getByRole('tab', { name: 'Routing' }))
    await user.clear(await screen.findByLabelText('Port env var'))
    await user.type(screen.getByLabelText('Port env var'), 'API_PORT')
    await user.click(screen.getByRole('button', { name: 'Save routing' }))
    await waitFor(() => expect(projectFetchCount).toBeGreaterThan(1))

    await user.click(screen.getByRole('tab', { name: 'Environment' }))
    expect(await screen.findByRole('button', { name: /^FOO$/ })).toHaveTextContent('edited')
  })
})