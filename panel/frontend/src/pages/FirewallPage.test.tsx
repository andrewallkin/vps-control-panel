import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirewallPage } from './FirewallPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const baseRules = [
  {
    number: 1,
    to: '22/tcp',
    proto: 'tcp',
    action: 'ALLOW IN',
    from: 'Anywhere',
    v6: false,
    comment: 'ssh',
  },
  {
    number: 2,
    to: '80/tcp',
    proto: 'tcp',
    action: 'ALLOW IN',
    from: 'Anywhere',
    v6: false,
    comment: 'http',
  },
  {
    number: 3,
    to: '443/tcp',
    proto: 'tcp',
    action: 'ALLOW IN',
    from: 'Anywhere',
    v6: false,
    comment: 'https',
  },
]

const exposureRows = [
  {
    address: '0.0.0.0',
    port: 22,
    process: 'sshd',
    proto: 'tcp',
    external: true,
    expected: true,
  },
  {
    address: '0.0.0.0',
    port: 10001,
    process: 'app',
    proto: 'tcp',
    external: true,
    expected: false,
  },
]

describe('FirewallPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/firewall/rules')) {
          return Promise.resolve(jsonResponse(baseRules))
        }
        if (url.includes('/api/firewall/exposure')) {
          return Promise.resolve(jsonResponse(exposureRows))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a locked delete control for HTTPS allow rules when Cloudflare-only is off', async () => {
    renderWithProviders(<FirewallPage />)

    await waitFor(() => {
      expect(screen.getByText('443')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByRole('button', { name: /delete rule/i })
    const httpsDelete = deleteButtons.find((button) => button.closest('tr')?.textContent?.includes('443'))
    expect(httpsDelete).toBeDefined()
    expect(httpsDelete).toBeDisabled()
    expect(screen.getByLabelText(/443.*locked/i)).toBeInTheDocument()
  })

  it('marks unexpected external exposure with a red indicator', async () => {
    renderWithProviders(<FirewallPage />)

    await waitFor(() => {
      expect(screen.getByText('10001')).toBeInTheDocument()
    })

    expect(screen.getByText('Unexpected')).toBeInTheDocument()
    expect(screen.getByLabelText(/unexpected exposure on port 10001/i)).toBeInTheDocument()
  })

  it('shows the expected external ports guidance sentence', async () => {
    renderWithProviders(<FirewallPage />)

    await waitFor(() => {
      expect(
        screen.getByText('Expected: only 22, 80, 443 reachable'),
      ).toBeInTheDocument()
    })
  })
})
