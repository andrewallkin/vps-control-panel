import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectPage } from './ProjectPage'
import { renderWithProviders } from '../test/renderWithProviders'
import type { DeployRow } from '../lib/projectDeployTypes'

vi.mock('../lib/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/projectsApi')>()
  return {
    ...actual,
    deleteProject: vi.fn(),
    fetchComposePs: vi.fn(),
    fetchComposeServices: vi.fn(),
    fetchProject: vi.fn(),
    fetchProjectDeploys: vi.fn(),
    fetchProjectDumps: vi.fn(),
    fetchProjectEnv: vi.fn(),
    fetchProjectPorts: vi.fn(),
    fetchProjectTags: vi.fn(),
    deployToApplyEnv: vi.fn(),
    patchProjectEnv: vi.fn(),
    patchProjectSettings: vi.fn(),
    projectDumpDownloadUrl: vi.fn(),
    putProjectRouting: vi.fn(),
    putProjectServices: vi.fn(),
    redeployDeploy: vi.fn(),
    migrateProject: vi.fn(),
    startProjectDeploy: vi.fn(),
  }
})
vi.mock('../lib/dashboardApi', () => ({ fetchContainerMetrics: vi.fn() }))
vi.mock('../lib/databaseApi', () => ({
  fetchDatabases: vi.fn(),
  rotateDatabasePassword: vi.fn(),
}))
vi.mock('../lib/domainsApi', () => ({ fetchDomains: vi.fn() }))

import {
  fetchProject,
  fetchProjectDeploys,
  fetchProjectTags,
  startProjectDeploy,
} from '../lib/projectsApi'
import type { ProjectDetail } from '../lib/projectsApi'

const project: ProjectDetail = {
  slug: 'demo',
  display_name: 'Demo',
  repo_url: 'https://github.com/acme/demo.git',
  branch: 'main',
  compose_file: 'docker-compose.yml',
  deploy_mode: 'image',
  docker_hub_repo: 'acme/demo',
  database_mode: 'none',
  db_name: null,
  db_user: null,
  write_database_url: false,
  migration_command: null,
  migration_service: null,
  health_check_url: null,
  creation_state: { status: 'ready', steps: [] },
  created_at: '2025-06-15T12:00:00',
  hostnames: [],
  routes: [],
  services: [
    { service_name: 'web', image_env_var: 'DOCKER_IMAGE_WEB', tag_prefix: 'backend', current_tag: null },
  ],
}

function deployRow(overrides: Partial<DeployRow> = {}): DeployRow {
  return {
    id: 1,
    status: 'running',
    trigger: 'deploy',
    tags: { DOCKER_IMAGE_WEB: 'backend-main-abc1234' },
    commit: null,
    started_at: '2025-06-15T12:00:00',
    finished_at: null,
    log: '',
    job_id: 'job-1',
    ...overrides,
  }
}

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener() {}
  close() {
    this.closed = true
  }
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:slug" element={<ProjectPage />} />
    </Routes>,
    { routerProps: { initialEntries: ['/projects/demo'] } },
  )
}

describe('ProjectPage deploy log live view', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
    vi.mocked(fetchProject).mockResolvedValue(project)
    vi.mocked(fetchProjectTags).mockResolvedValue({
      services: [
        { service: 'web', image_env_var: 'DOCKER_IMAGE_WEB', tags: ['backend-main-abc1234'] },
      ],
    })
    vi.mocked(fetchProjectDeploys).mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refetches the deploys list while the deploy request is in flight and opens the live stream', async () => {
    const user = userEvent.setup()
    let resolveDeploy: (value: { id: number; status: string }) => void = () => {}
    vi.mocked(startProjectDeploy).mockReturnValue(
      new Promise((resolve) => {
        resolveDeploy = resolve
      }),
    )

    renderPage()

    await user.click(await screen.findByRole('tab', { name: 'Deploy' }))
    const deployButton = await screen.findByRole('button', { name: 'Deploy' })
    await waitFor(() => expect(deployButton).toBeEnabled(), { timeout: 5000 })
    expect(vi.mocked(fetchProjectDeploys)).toHaveBeenCalledTimes(1)

    await user.click(deployButton)
    expect(vi.mocked(startProjectDeploy)).toHaveBeenCalled()

    // Deploy POST is still pending: the list must keep polling so the
    // running row (and its job_id for the SSE stream) appears.
    vi.mocked(fetchProjectDeploys).mockClear()
    await waitFor(
      () => {
        expect(vi.mocked(fetchProjectDeploys).mock.calls.length).toBeGreaterThanOrEqual(2)
      },
      { timeout: 6000 },
    )

    // Once the running row is fetched, the log box streams from the agent.
    vi.mocked(fetchProjectDeploys).mockResolvedValue([deployRow()])
    await waitFor(
      () => {
        expect(MockEventSource.instances).toHaveLength(1)
      },
      { timeout: 6000 },
    )
    expect(MockEventSource.instances[0].url).toBe('/api/jobs/job-1/events')

    resolveDeploy({ id: 1, status: 'running' })
  }, 20000)

  it('shows the deploy log box for a running deploy without waiting for the POST to finish', async () => {
    const user = userEvent.setup()
    vi.mocked(startProjectDeploy).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    )

    renderPage()

    await user.click(await screen.findByRole('tab', { name: 'Deploy' }))
    await user.click(await screen.findByRole('button', { name: 'Deploy' }))

    vi.mocked(fetchProjectDeploys).mockResolvedValue([
      deployRow({ log: 'streamed line' }),
    ])

    await waitFor(
      () => {
        expect(screen.getByText('streamed line')).toBeInTheDocument()
      },
      { timeout: 6000 },
    )
  }, 20000)

  it('keeps the finished deploy log visible right after the deploy completes', async () => {
    const user = userEvent.setup()
    let resolveDeploy: (value: { id: number; status: string }) => void = () => {}
    vi.mocked(startProjectDeploy).mockReturnValue(
      new Promise((resolve) => {
        resolveDeploy = resolve
      }),
    )

    renderPage()

    await user.click(await screen.findByRole('tab', { name: 'Deploy' }))
    await user.click(await screen.findByRole('button', { name: 'Deploy' }))

    vi.mocked(fetchProjectDeploys).mockResolvedValue([deployRow()])
    await waitFor(
      () => {
        expect(MockEventSource.instances).toHaveLength(1)
      },
      { timeout: 6000 },
    )

    // Deploy finishes: POST resolves and the polled row is terminal.
    resolveDeploy({ id: 1, status: 'succeeded' })
    vi.mocked(fetchProjectDeploys).mockResolvedValue([
      deployRow({ status: 'succeeded', finished_at: '2025-06-15T12:00:07', log: 'final log' }),
    ])

    // The log box must survive the finish transition (10s hold), not vanish.
    await waitFor(
      () => {
        expect(screen.getByText('final log')).toBeInTheDocument()
      },
      { timeout: 6000 },
    )
  }, 20000)
})
