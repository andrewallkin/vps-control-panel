import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DomainsPage } from './DomainsPage'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners: Record<string, Array<(event: MessageEvent<string>) => void>> = {}

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    this.listeners[type] = this.listeners[type] ?? []
    this.listeners[type].push(handler)
  }

  close() {}

  emit(type: string, data: string) {
    for (const handler of this.listeners[type] ?? []) {
      handler({ data } as MessageEvent<string>)
    }
  }
}

vi.mock('../lib/domainsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/domainsApi')>()),
  fetchCloudflareZones: vi.fn(),
  fetchDomains: vi.fn(),
  fetchPanelHostname: vi.fn(),
  registerDomain: vi.fn(),
  reissueDomain: vi.fn(),
  deleteDomain: vi.fn(),
}))

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DomainsPage panel hostname', () => {
  it('lists zone, panel, and project hostnames with labels', async () => {
    const { fetchCloudflareZones, fetchDomains, fetchPanelHostname } = await import(
      '../lib/domainsApi'
    )
    vi.mocked(fetchCloudflareZones).mockResolvedValue({
      configured: true,
      zones: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
    })
    vi.mocked(fetchDomains).mockResolvedValue([
      {
        name: 'example.com',
        zone_id: 'zone-1',
        cert_status: 'valid',
        cert_expires_at: '2027-01-01T00:00:00.000Z',
        ssl_mode: 'strict',
        ssl_mode_error: null,
        warning: null,
        hostnames: [
          {
            fqdn: 'example.com',
            kind: 'zone',
            project_slug: null,
            project_name: null,
          },
          {
            fqdn: 'panel.example.com',
            kind: 'panel',
            project_slug: null,
            project_name: null,
          },
          {
            fqdn: 'app.example.com',
            kind: 'primary',
            project_slug: 'blog',
            project_name: 'Blog',
          },
        ],
      },
    ])
    vi.mocked(fetchPanelHostname).mockResolvedValue({ panel_hostname: 'panel.example.com' })

    renderWithClient(<DomainsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading domains…')).not.toBeInTheDocument()
    })

    expect(screen.getAllByText('example.com')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /reissue/i })).toBeInTheDocument()

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4)

    const domain = within(rows[1]!)
    expect(domain.getByText('example.com')).toBeInTheDocument()
    expect(domain.getByText('Domain')).toBeInTheDocument()
    expect(domain.getByText('Apex')).toBeInTheDocument()

    const panel = within(rows[2]!)
    expect(panel.getByText('panel.example.com')).toBeInTheDocument()
    expect(panel.getByText('Subdomain')).toBeInTheDocument()
    expect(panel.getByText('Panel')).toBeInTheDocument()

    const project = within(rows[3]!)
    expect(project.getByText('app.example.com')).toBeInTheDocument()
    expect(project.getByText('Subdomain')).toBeInTheDocument()
    expect(project.getByText('Blog')).toBeInTheDocument()

    const page = screen.getByRole('heading', { name: 'Domains' }).parentElement?.parentElement
      ?.parentElement
    expect(page).toHaveClass('w-full')
    expect(page).not.toHaveClass('max-w-6xl')
  })
})

describe('DomainsPage certificate issue', () => {
  async function seedDomainsPage() {
    const { fetchCloudflareZones, fetchDomains, fetchPanelHostname } = await import(
      '../lib/domainsApi'
    )
    vi.mocked(fetchCloudflareZones).mockResolvedValue({
      configured: true,
      zones: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
    })
    vi.mocked(fetchDomains).mockResolvedValue([
      {
        name: 'example.com',
        zone_id: 'zone-1',
        cert_status: 'missing',
        cert_expires_at: null,
        ssl_mode: 'strict',
        ssl_mode_error: null,
        warning: null,
        hostnames: [
          {
            fqdn: 'example.com',
            kind: 'zone',
            project_slug: null,
            project_name: null,
          },
        ],
      },
    ])
    vi.mocked(fetchPanelHostname).mockResolvedValue({ panel_hostname: null })
    return { fetchDomains }
  }

  it('stops polling domains after the certificate job ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    const { fetchDomains, reissueDomain } = await import('../lib/domainsApi')
    await seedDomainsPage()
    vi.mocked(reissueDomain).mockResolvedValue({ job_id: 'job-reissue-1' })

    renderWithClient(<DomainsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading domains…')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /reissue/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /certificate issue log/i })).toBeInTheDocument()
    })

    await vi.advanceTimersByTimeAsync(11_000)
    expect(vi.mocked(fetchDomains).mock.calls.length).toBeGreaterThan(1)

    const source = MockEventSource.instances[0]!
    source.emit('end', JSON.stringify({ exit_code: 0 }))
    await vi.advanceTimersByTimeAsync(100)

    const callsAfterEnd = vi.mocked(fetchDomains).mock.calls.length
    await vi.advanceTimersByTimeAsync(15_000)
    expect(vi.mocked(fetchDomains).mock.calls.length).toBe(callsAfterEnd)
    expect(screen.getByRole('heading', { name: /certificate issue log/i })).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
  })

  it('shows issuance error when register succeeds without a job', async () => {
    const user = userEvent.setup()
    const { fetchDomains, registerDomain } = await import('../lib/domainsApi')
    await seedDomainsPage()
    vi.mocked(registerDomain).mockResolvedValue({
      job_id: null,
      issue_error: 'DNS challenge failed',
    })
    vi.mocked(fetchDomains).mockResolvedValue([
      {
        name: 'example.com',
        zone_id: 'zone-1',
        cert_status: 'missing',
        cert_expires_at: null,
        ssl_mode: 'strict',
        ssl_mode_error: null,
        warning: null,
        hostnames: [
          {
            fqdn: 'example.com',
            kind: 'zone',
            project_slug: null,
            project_name: null,
          },
        ],
      },
    ])

    renderWithClient(<DomainsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading domains…')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /add domain/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /add domain/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('DNS challenge failed')
    expect(screen.queryByRole('heading', { name: /certificate issue log/i })).not.toBeInTheDocument()
  })
})
