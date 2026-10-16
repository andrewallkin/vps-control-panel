import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectPortsSection } from './ProjectPortsSection'
import { ApiError } from '../../lib/api'
import { renderWithProviders as render } from '../../test/renderWithProviders'

const putMock = vi.fn()

vi.mock('../../lib/projectsApi', () => ({
  fetchProjectPorts: vi.fn(async () => ({
    ports: [
      { service: 'backend', env_var: 'BACKEND_PORT', default: 8000, host_port: 8001 },
      { service: 'frontend', env_var: 'FRONTEND_PORT', default: 3000, host_port: 10001 },
    ],
  })),
  fetchUsedPorts: vi.fn(async () => [
    { port: 8001, owner: 'myapp', env_var: 'BACKEND_PORT' },
    { port: 10001, owner: 'myapp', env_var: 'FRONTEND_PORT' },
    { port: 9000, owner: 'otherapp', env_var: 'WEB_PORT' },
  ]),
  putProjectPorts: (...args: unknown[]) => putMock(...args),
}))

describe('ProjectPortsSection', () => {
  beforeEach(() => {
    putMock.mockReset()
    putMock.mockResolvedValue({ ports: [] })
  })

  it('renders port mappings when mounted with a warm query cache', async () => {
    const { QueryClient } = await import('@tanstack/react-query')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(['projects', 'myapp', 'ports'], {
      ports: [
        { service: 'backend', env_var: 'BACKEND_PORT', default: 8000, host_port: 8001 },
        { service: 'frontend', env_var: 'FRONTEND_PORT', default: 3000, host_port: 10001 },
      ],
    })
    render(<ProjectPortsSection slug="myapp" />, { queryClient })
    expect(await screen.findByLabelText('BACKEND_PORT host port')).toHaveValue('8001')
    expect(screen.getByLabelText('FRONTEND_PORT host port')).toHaveValue('10001')
  })

  it('renders fetched port mappings with their host ports', async () => {
    render(<ProjectPortsSection slug="myapp" />)
    const backend = (await screen.findByLabelText('BACKEND_PORT host port')) as HTMLInputElement
    expect(backend.value).toBe('8001')
    const frontend = screen.getByLabelText('FRONTEND_PORT host port') as HTMLInputElement
    expect(frontend.value).toBe('10001')
    expect(screen.getByText(/compose default 8000/i)).toBeInTheDocument()
  })

  it('saves edited ports and shows the redeploy note', async () => {
    const user = userEvent.setup()
    putMock.mockResolvedValue({
      ports: [
        { service: 'backend', env_var: 'BACKEND_PORT', default: 8000, host_port: 8002 },
        { service: 'frontend', env_var: 'FRONTEND_PORT', default: 3000, host_port: 10001 },
      ],
    })
    render(<ProjectPortsSection slug="myapp" />)
    const backend = await screen.findByLabelText('BACKEND_PORT host port')
    await user.clear(backend)
    await user.type(backend, '8002')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith('myapp', {
        BACKEND_PORT: 8002,
        FRONTEND_PORT: 10001,
      })
    })
    expect(await screen.findByText(/redeploy/i)).toBeInTheDocument()
    const saved = (await screen.findByLabelText('BACKEND_PORT host port')) as HTMLInputElement
    expect(saved.value).toBe('8002')
  })

  it('shows an API error when saving fails', async () => {
    const user = userEvent.setup()
    putMock.mockRejectedValue(
      new ApiError(502, { detail: 'agent unavailable' }),
    )
    render(<ProjectPortsSection slug="myapp" />)
    const backend = await screen.findByLabelText('BACKEND_PORT host port')
    await user.clear(backend)
    await user.type(backend, '8003')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/agent unavailable/i)
    })
  })
})

describe('ProjectPortsSection error state', () => {
  it('shows an error and retries when loading fails', async () => {
    const user = userEvent.setup()
    const { fetchProjectPorts } = await import('../../lib/projectsApi')
    const fetchMock = vi.mocked(fetchProjectPorts)
    fetchMock.mockRejectedValueOnce(new ApiError(502, { detail: 'agent restarting' }))
    fetchMock.mockResolvedValueOnce({
      ports: [
        { service: 'backend', env_var: 'BACKEND_PORT', default: 8000, host_port: 8001 },
      ],
    })
    render(<ProjectPortsSection slug="myapp" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/agent restarting/i)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByLabelText('BACKEND_PORT host port')).toBeInTheDocument()
  })
})
