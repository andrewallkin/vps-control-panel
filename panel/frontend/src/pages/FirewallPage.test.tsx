import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    address: '::',
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
  {
    address: '127.0.0.53%lo',
    port: 53,
    process: 'systemd-resolve',
    proto: 'tcp',
    external: false,
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

    const page = screen.getByRole('heading', { name: 'Firewall' }).parentElement?.parentElement
      ?.parentElement
    expect(page).toHaveClass('w-full')
    expect(page).not.toHaveClass('max-w-6xl')

    const deleteButtons = screen.getAllByRole('button', { name: /delete rule/i })
    const httpsDelete = deleteButtons.find((button) => button.closest('tr')?.textContent?.includes('443'))
    expect(httpsDelete).toBeDefined()
    expect(httpsDelete).toBeDisabled()
    expect(screen.getByLabelText(/443.*locked/i)).toBeInTheDocument()
    const rules = within(screen.getByRole('region', { name: 'Rules' }))
    expect(rules.getAllByText('Kept open').length).toBeGreaterThan(0)
    expect(rules.getAllByRole('cell', { name: /^IPv4$/ })).toHaveLength(baseRules.length)
    expect(rules.getAllByRole('cell', { name: 'Anyone on the internet' })).toHaveLength(baseRules.length)
  })

  it('marks unexpected external exposure with a red indicator', async () => {
    renderWithProviders(<FirewallPage />)

    await waitFor(() => {
      expect(screen.getByText('10001')).toBeInTheDocument()
    })

    expect(screen.getByText('Problem')).toBeInTheDocument()
    expect(screen.getByLabelText(/problem: port 10001 is reachable from the internet/i)).toBeInTheDocument()
    expect(screen.getByText('IPv4 and IPv6')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'SSH' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'sshd' })).toBeInTheDocument()
  })

  it('shows the expected external ports guidance sentence', async () => {
    renderWithProviders(<FirewallPage />)

    await waitFor(() => {
      expect(
        screen.getByText(
          'Public listeners should be SSH (22) and the web server (80 and 443). Anything else listening for the whole internet is marked as a problem.',
        ),
      ).toBeInTheDocument()
    })
  })

  it('keeps machine-local listeners collapsed until opened', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FirewallPage />)

    const summary = await screen.findByText(/only on this machine \(1\)/i)
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')

    await user.click(summary)

    expect(details).toHaveAttribute('open')
    expect(screen.getByText('127.0.0.53')).toBeInTheDocument()
    expect(screen.getByText('loopback interface')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'DNS stub' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'systemd-resolve' })).toBeInTheDocument()
    expect(screen.getByText('Local only')).toBeInTheDocument()
  })
})
