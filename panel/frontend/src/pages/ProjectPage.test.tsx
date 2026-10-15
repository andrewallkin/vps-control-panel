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
        if (url.includes('/api/database/databases')) {
          return Promise.resolve(
            jsonResponse([
              {
                name: 'demo',
                owner: 'demo_user',
                size_bytes: 8192,
                attached_slug: 'demo',
              },
            ]),
          )
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

  it('shows the database size', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Database' }))

    expect(await screen.findByText('8 KiB')).toBeInTheDocument()
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

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners: Record<string, Array<(event: MessageEvent<string>) => void>> = {}
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    this.listeners[type] = this.listeners[type] ?? []
    this.listeners[type].push(handler)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: string) {
    const event = { data } as MessageEvent<string>
    if (type === 'message') {
      this.onmessage?.(event)
    }
    for (const handler of this.listeners[type] ?? []) {
      handler(event)
    }
  }
}

const runningProject = {
  ...project,
  migration_command: 'bash /app/run_migrations.sh',
  migration_service: 'backend',
  hostnames: [{ domain: 'andrewallkin.com', subdomain: 'spliteasy', kind: 'primary' as const }],
  routes: [{ path_prefix: '/', port_env_var: 'PORT' }],
}

describe('ProjectPage overview, logs, and migrations', () => {
  beforeEach(() => {
    window.location.hash = ''
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/api/projects/demo') && (!init?.method || init.method === 'GET')) {
          return Promise.resolve(jsonResponse(runningProject))
        }
        if (url.includes('/compose/ps')) {
          return Promise.resolve(
            jsonResponse({
              services: [
                {
                  service: 'backend',
                  state: 'running',
                  health: '',
                  image: 'andrewallkin/spliteasy:backend',
                  started_at: '2026-10-14 16:00:00 +0000 UTC',
                  container: 'demo-backend-1',
                },
                {
                  service: 'frontend',
                  state: 'running',
                  health: '',
                  image: 'andrewallkin/spliteasy:frontend',
                  started_at: '',
                },
              ],
            }),
          )
        }
        if (url.includes('/api/metrics/containers')) {
          return Promise.resolve(
            jsonResponse([
              {
                name: 'demo-backend-1',
                project: 'demo',
                cpu_percent: 1.5,
                mem_used: 1048576,
                mem_limit: 2097152,
                mem_percent: 50,
              },
              {
                name: 'demo-frontend-1',
                project: 'demo',
                cpu_percent: 0.4,
                mem_used: 2097152,
                mem_limit: 2097152,
                mem_percent: 100,
              },
            ]),
          )
        }
        if (url.includes('/deploys')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/tags')) {
          return Promise.resolve(jsonResponse({ services: [] }))
        }
        if (url.endsWith('/migrate') && init?.method === 'POST') {
          return Promise.resolve(jsonResponse({ job_id: 'job-migrate' }))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function renderProject(hash = '') {
    window.location.hash = hash
    return renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo'] } },
    )
  }

  it('shows service name, start time, cpu, and memory from compose ps and container stats', async () => {
    renderProject()

    expect(await screen.findByRole('heading', { name: 'Demo' })).toBeInTheDocument()
    expect(await screen.findByText('backend')).toBeInTheDocument()
    expect(screen.getByText('frontend')).toBeInTheDocument()
    expect(screen.getByText('2026-10-14 16:00:00 +0000 UTC')).toBeInTheDocument()
    expect(screen.getByText('1.5%')).toBeInTheDocument()
    expect(screen.getByText('0.4%')).toBeInTheDocument()
    expect(screen.getByText('1 MiB')).toBeInTheDocument()
    expect(screen.getByText('2 MiB')).toBeInTheDocument()
  })

  it('opens project URLs in a new tab', async () => {
    renderProject()

    const link = await screen.findByRole('link', { name: 'https://spliteasy.andrewallkin.com/' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('lists compose services in the log filter and requests that service', async () => {
    const user = userEvent.setup()
    renderProject('#logs')

    const filter = await screen.findByLabelText('Service')
    expect(within(filter).getByRole('option', { name: 'All services' })).toBeInTheDocument()
    expect(within(filter).getByRole('option', { name: 'backend' })).toBeInTheDocument()
    expect(within(filter).getByRole('option', { name: 'frontend' })).toBeInTheDocument()

    const initial = MockEventSource.instances[0]
    initial?.emit('message', 'from all services')
    expect(await screen.findByText('from all services')).toBeInTheDocument()

    await user.selectOptions(filter, 'backend')

    await waitFor(() => {
      const latest = MockEventSource.instances.at(-1)
      expect(latest?.url).toContain('service=backend')
    })
    expect(screen.queryByText('from all services')).not.toBeInTheDocument()
  })

  it('keeps the migration log readable after the job ends, then dismisses it', async () => {
    const user = userEvent.setup()
    renderProject('#deploy')

    await user.click(await screen.findByRole('button', { name: 'Run migrations' }))
    expect(await screen.findByRole('heading', { name: 'Migration log' })).toBeInTheDocument()

    const source = MockEventSource.instances[0]
    expect(source).toBeDefined()
    source!.emit('line', JSON.stringify({ n: 0, text: 'migration applied' }))
    expect(await screen.findByText('migration applied')).toBeInTheDocument()

    vi.useFakeTimers()
    source!.emit('end', JSON.stringify({ status: 'succeeded' }))
    expect(screen.getByText('migration applied')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(19_999)
    expect(screen.getByText('migration applied')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(1)
    expect(screen.queryByRole('heading', { name: 'Migration log' })).not.toBeInTheDocument()
  })
})

describe('ProjectPage ports tab', () => {
  beforeEach(() => {
    window.location.hash = ''
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/projects/demo') && method === 'GET') {
          return Promise.resolve(jsonResponse(project))
        }
        if (url.endsWith('/api/projects/demo/ports') && method === 'GET') {
          return Promise.resolve(
            jsonResponse({
              ports: [
                { service: 'backend', env_var: 'BACKEND_PORT', default: 8000, host_port: 8001 },
              ],
            }),
          )
        }
        if (url.endsWith('/api/ports/used')) {
          return Promise.resolve(
            jsonResponse([
              { port: 8001, owner: 'demo', env_var: 'BACKEND_PORT' },
              { port: 8000, owner: 'spliteasy', env_var: 'WEB_PORT' },
            ]),
          )
        }
        if (url.endsWith('/api/projects/demo/ports') && method === 'PUT') {
          return Promise.resolve(
            jsonResponse({
              ports: [
                { service: 'backend', env_var: 'BACKEND_PORT', default: 8000, host_port: 8002 },
              ],
            }),
          )
        }
        if (url.includes('/domains')) {
          return Promise.resolve(jsonResponse([]))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderPortsTab() {
    window.location.hash = '#ports'
    return renderWithProviders(
      <Routes>
        <Route path="/projects/:slug" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/projects/demo#ports'] } },
    )
  }

  it('shows port mappings with in-use hints', async () => {
    renderPortsTab()
    const backend = (await screen.findByLabelText('BACKEND_PORT host port')) as HTMLInputElement
    expect(backend.value).toBe('8001')
    expect(await screen.findByText(/current/i)).toBeInTheDocument()
    expect(screen.getByText(/compose default 8000/i)).toBeInTheDocument()
  })

  it('saves edited ports', async () => {
    const user = userEvent.setup()
    renderPortsTab()
    const backend = (await screen.findByLabelText('BACKEND_PORT host port')) as HTMLInputElement
    await user.clear(backend)
    await user.type(backend, '8002')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/redeploy/i)).toBeInTheDocument()
  })
})
