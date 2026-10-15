import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '../../test/renderWithProviders'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PortsConfirmSection } from './PortsConfirmSection'

const confirmMock = vi.fn()

vi.mock('../../lib/projectsApi', () => ({
  fetchUsedPorts: vi.fn(async () => [
    { port: 8000, owner: 'spliteasy', env_var: 'BACKEND_PORT' },
  ]),
  confirmCreationPorts: (...args: unknown[]) => confirmMock(...args),
}))

describe('PortsConfirmSection', () => {
  beforeEach(() => {
    confirmMock.mockReset()
    confirmMock.mockResolvedValue({ slug: 'myapp', creation_state: { status: 'running' } })
  })

  it('renders one field per port choice prefilled with the compose default', async () => {
    render(
      <PortsConfirmSection
        slug="myapp"
        portChoices={{ BACKEND_PORT: 8000, FRONTEND_PORT: 3000 }}
      />,
    )
    const backend = screen.getByLabelText('BACKEND_PORT host port') as HTMLInputElement
    expect(backend.value).toBe('8000')
    const frontend = screen.getByLabelText('FRONTEND_PORT host port') as HTMLInputElement
    expect(frontend.value).toBe('3000')
    await screen.findByText(/used by spliteasy/i)
  })

  it('submits the chosen ports and calls onConfirmed', async () => {
    const user = userEvent.setup()
    const onConfirmed = vi.fn()
    render(
      <PortsConfirmSection
        slug="myapp"
        portChoices={{ BACKEND_PORT: 8000, FRONTEND_PORT: 3000 }}
        onConfirmed={onConfirmed}
      />,
    )
    await user.clear(screen.getByLabelText('BACKEND_PORT host port'))
    await user.type(screen.getByLabelText('BACKEND_PORT host port'), '8001')
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith('myapp', {
        BACKEND_PORT: 8001,
        FRONTEND_PORT: 3000,
      })
    })
    expect(onConfirmed).toHaveBeenCalled()
  })

  it('blocks submission when a chosen port is taken and shows the conflict', async () => {
    const user = userEvent.setup()
    render(
      <PortsConfirmSection
        slug="myapp"
        portChoices={{ BACKEND_PORT: 8000, FRONTEND_PORT: 3000 }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/used by spliteasy/i)
    })
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('shows the API error when confirmation fails', async () => {
    const user = userEvent.setup()
    confirmMock.mockRejectedValue(
      new Error('Port 8001 is allocated to other (WEB_PORT)'),
    )
    render(
      <PortsConfirmSection
        slug="myapp"
        portChoices={{ BACKEND_PORT: 8001, FRONTEND_PORT: 3000 }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/allocated to other/i)
    })
  })
})
